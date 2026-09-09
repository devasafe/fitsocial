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

  it("rejeita kind desconhecido (400)", async () => {
    const res = await request(app)
      .post("/activities")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(strengthBody({ kind: "xadrez" }));
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

describe("Activities — formatos 2b (endurance/class/generic)", () => {
  it("cria corrida (endurance) com métricas de pace", async () => {
    const res = await request(app)
      .post("/activities")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ sportId: "corrida", kind: "endurance", durationSec: 1800, payload: { distanceM: 5000 } });
    expect(res.status).toBe(201);
    expect(res.body.data.kind).toBe("endurance");
    expect(res.body.data.metrics.distanceKm).toBe(5);
    expect(res.body.data.metrics.avgPaceSecPerKm).toBe(360);
  });

  it("cria aula (class)", async () => {
    const res = await request(app)
      .post("/activities")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ sportId: "jiu_jitsu", kind: "class", durationSec: 3600, payload: { modality: "jiu_jitsu" } });
    expect(res.status).toBe(201);
    expect(res.body.data.metrics.minutes).toBe(60);
  });

  it("cria atividade genérica", async () => {
    const res = await request(app)
      .post("/activities")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ sportId: "outro", kind: "generic", durationSec: 1200, payload: { activityName: "Surf" } });
    expect(res.status).toBe(201);
    expect(res.body.data.metrics.minutes).toBe(20);
  });

  it("cria WOD (crossfit) for_time", async () => {
    const res = await request(app)
      .post("/activities")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        sportId: "crossfit",
        kind: "wod",
        payload: { name: "Fran", scoreType: "for_time", level: "rx", resultTimeSec: 252 },
      });
    expect(res.status).toBe(201);
    expect(res.body.data.kind).toBe("wod");
  });

  it("cria WOD com lista de movimentos (carga/reps/tempo)", async () => {
    const res = await request(app)
      .post("/activities")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        sportId: "crossfit",
        kind: "wod",
        payload: {
          name: "WOD do dia",
          scoreType: "amrap",
          level: "rx",
          resultRounds: 8,
          movements: [
            { name: "Back Squat", loadKg: 100, reps: 5 },
            { name: "Thrusters", loadKg: 42.5, reps: 21 },
            { name: "Run", timeSec: 200 },
          ],
        },
      });
    expect(res.status).toBe(201);
    expect(res.body.data.payload.movements).toHaveLength(3);
    expect(res.body.data.payload.movements[0].name).toBe("Back Squat");
    expect(res.body.data.payload.movements[0].loadKg).toBe(100);
    expect(res.body.data.payload.movements[2].timeSec).toBe(200);
  });

  it("outro usuário abre a atividade COMPARTILHADA, mas não a privada não compartilhada", async () => {
    // A compartilha um treino no feed → B consegue abrir.
    const shared = await request(app)
      .post("/activities")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(strengthBody({ shareToFeed: true }));
    const sharedId = shared.body.data.id;
    const okB = await request(app).get(`/activities/${sharedId}`).set("Authorization", `Bearer ${tokenB}`);
    expect(okB.status).toBe(200);
    expect(okB.body.data.id).toBe(sharedId);
    // Traz o dono para o cabeçalho do detalhe.
    expect(okB.body.data.owner).toBeTruthy();
    expect(typeof okB.body.data.owner.name).toBe("string");
    // Traz o post do compartilhamento (para curtir/comentar no detalhe).
    expect(okB.body.data.post).toBeTruthy();
    expect(typeof okB.body.data.post.id).toBe("string");
    expect(okB.body.data.post.likedByMe).toBe(false);

    // A registra um treino privado sem compartilhar → B não vê.
    const priv = await request(app)
      .post("/activities")
      .set("Authorization", `Bearer ${tokenA}`)
      .send(strengthBody({ visibility: "private" }));
    const privId = priv.body.data.id;
    const denyB = await request(app).get(`/activities/${privId}`).set("Authorization", `Bearer ${tokenB}`);
    expect(denyB.status).toBe(404);
  });
});

describe("Recordes de força (PR)", () => {
  function bench(weightKg: number) {
    return {
      sportId: "musculacao",
      kind: "strength",
      payload: { exercises: [{ name: "Agachamento", sets: [{ type: "valida", weightKg, reps: 5 }] }] },
    };
  }

  it("primeiro treino não celebra; superar depois celebra com valor anterior", async () => {
    const first = await request(app).post("/activities").set("Authorization", `Bearer ${tokenB}`).send(bench(100));
    expect(first.body.meta.newPRs).toHaveLength(0);

    const second = await request(app).post("/activities").set("Authorization", `Bearer ${tokenB}`).send(bench(110));
    const cargaMax = second.body.meta.newPRs.find(
      (p: { type: string }) => p.type === "carga_max"
    );
    expect(cargaMax).toBeTruthy();
    expect(cargaMax.value).toBe(110);
    expect(cargaMax.previousValue).toBe(100);
  });

  it("GET /prs lista os recordes do usuário", async () => {
    const res = await request(app).get("/prs").set("Authorization", `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body.data.some((p: { exerciseName: string }) => p.exerciseName === "Agachamento")).toBe(true);
  });
});

describe("Track de GPS (endurance, Fase 3a)", () => {
  function track(secPerSeg: number) {
    const points = [];
    for (let i = 0; i <= 15; i++) points.push({ lat: 0, lng: i * 0.001, t: i * secPerSeg });
    return points;
  }

  it("cria endurance com track: deriva distância, polyline e melhores trechos", async () => {
    const first = await request(app)
      .post("/activities")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ sportId: "corrida", kind: "endurance", payload: { points: track(10) } });
    expect(first.status).toBe(201);
    expect(first.body.data.metrics.distanceKm).toBeGreaterThan(1);
    expect(typeof first.body.data.payload.polyline).toBe("string");
    expect(first.body.meta.newPRs).toHaveLength(0); // linha de base

    const faster = await request(app)
      .post("/activities")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ sportId: "corrida", kind: "endurance", payload: { points: track(7) } });
    expect(faster.body.meta.newPRs.some((p: { type: string }) => p.type === "best_time")).toBe(true);
  });

  it("importa um GPX como atividade", async () => {
    const gpx = `<gpx><trkseg>
      <trkpt lat="0" lon="0"><time>2026-01-10T10:00:00Z</time></trkpt>
      <trkpt lat="0" lon="0.01"><time>2026-01-10T10:02:00Z</time></trkpt>
    </trkseg></gpx>`;
    const res = await request(app)
      .post("/activities/import-gpx")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ sportId: "corrida", gpx });
    expect(res.status).toBe(201);
    expect(res.body.data.metrics.distanceKm).toBeGreaterThan(0);
  });
});
