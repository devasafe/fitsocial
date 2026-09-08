import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { Post } from "../models/Post.js";

const app = createApp();
let mongod: MongoMemoryServer;
let tokenA = "";
let tokenB = "";

async function registrar(email: string): Promise<string> {
  const res = await request(app)
    .post("/auth/register")
    .send({ name: email, email, password: "senha12345" });
  return res.body.token;
}

function strengthBody(over: Record<string, unknown> = {}) {
  return {
    sportId: "musculacao",
    kind: "strength",
    payload: {
      exercises: [
        {
          name: "Supino",
          sets: [
            { type: "aquecimento", weightKg: 40, reps: 10 },
            { type: "valida", weightKg: 60, reps: 10 },
            { type: "valida", weightKg: 60, reps: 8 },
          ],
        },
      ],
    },
    ...over,
  };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  tokenA = await registrar("a@test.com");
  tokenB = await registrar("b@test.com");
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("GET /sports", () => {
  it("lista os 21 esportes", async () => {
    const res = await request(app).get("/sports").set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(21);
  });
});

describe("Activities", () => {
  it("cria uma atividade de força, calcula métricas e responde no envelope { data }", async () => {
    const res = await request(app)
      .post("/activities")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(strengthBody());
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.metrics.volumeTotalKg).toBe(60 * 10 + 60 * 8);
    expect(res.body.data.sportId).toBe("musculacao");
  });

  it("compartilha no feed criando um Post que referencia a atividade", async () => {
    const res = await request(app)
      .post("/activities")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(strengthBody({ shareToFeed: true, caption: "PR hoje!" }));
    expect(res.status).toBe(201);
    const postId = res.body.meta.sharedPostId;
    expect(postId).toBeTruthy();
    const post = await Post.findById(postId);
    expect(post?.get("activity")?.toString()).toBe(res.body.data.id);
    expect(post?.text).toBe("PR hoje!");
  });

  it("rejeita kind não suportado na 2a (400)", async () => {
    const res = await request(app)
      .post("/activities")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(strengthBody({ kind: "endurance" }));
    expect(res.status).toBe(400);
  });

  it("lista as próprias atividades com paginação por cursor", async () => {
    const p1 = await request(app)
      .get("/activities?limit=1")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(p1.status).toBe(200);
    expect(p1.body.data).toHaveLength(1);
    expect(p1.body.meta.nextCursor).toBeTruthy();

    const p2 = await request(app)
      .get(`/activities?limit=1&cursor=${encodeURIComponent(p1.body.meta.nextCursor)}`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(p2.status).toBe(200);
    expect(p2.body.data[0].id).not.toBe(p1.body.data[0].id);
  });

  it("edita e apaga a própria atividade", async () => {
    const created = await request(app)
      .post("/activities")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(strengthBody({ title: "antigo" }));
    const id = created.body.data.id;

    const patched = await request(app)
      .patch(`/activities/${id}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ title: "novo" });
    expect(patched.status).toBe(200);
    expect(patched.body.data.title).toBe("novo");

    const del = await request(app).delete(`/activities/${id}`).set("Authorization", `Bearer ${tokenA}`);
    expect(del.status).toBe(200);

    const get = await request(app).get(`/activities/${id}`).set("Authorization", `Bearer ${tokenA}`);
    expect(get.status).toBe(404);
  });

  it("esconde atividade privada de outro usuário (404)", async () => {
    const created = await request(app)
      .post("/activities")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(strengthBody({ visibility: "private" }));
    const id = created.body.data.id;

    const asB = await request(app).get(`/activities/${id}`).set("Authorization", `Bearer ${tokenB}`);
    expect(asB.status).toBe(404);
  });

  it("mostra atividade pública para outro usuário (200)", async () => {
    const created = await request(app)
      .post("/activities")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(strengthBody({ visibility: "public" }));
    const id = created.body.data.id;

    const asB = await request(app).get(`/activities/${id}`).set("Authorization", `Bearer ${tokenB}`);
    expect(asB.status).toBe(200);
  });
});
