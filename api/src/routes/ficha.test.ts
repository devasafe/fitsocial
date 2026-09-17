import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { Profile } from "../models/Profile.js";

const app = createApp();
let mongod: MongoMemoryServer;

const fullProfile = {
  goal: "ganhar_massa",
  sex: "masculino",
  age: 25,
  heightCm: 178,
  weightKg: 74,
  experienceLevel: "iniciante",
  daysPerWeek: 4,
  sessionMinutes: 60,
  dietaryRestrictions: [],
  injuriesConditions: [],
  notes: "",
};

async function registrar(email: string) {
  const reg = await request(app)
    .post("/auth/register")
    .send({ name: "Asafe", email, password: "senha12345" });
  return { token: reg.body.token as string, userId: reg.body.user.id as string };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("GET /ficha", () => {
  it("exige autenticação", async () => {
    const res = await request(app).get("/ficha");
    expect(res.status).toBe(401);
  });

  it("devolve null para quem ainda não preencheu a ficha", async () => {
    const { token } = await registrar("semficha@test.com");
    const res = await request(app).get("/ficha").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it("devolve a ficha de quem já preencheu", async () => {
    const { token } = await registrar("comficha@test.com");
    await request(app)
      .post("/onboarding/profile")
      .set("Authorization", `Bearer ${token}`)
      .send(fullProfile);

    const res = await request(app).get("/ficha").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.goal).toBe("ganhar_massa");
    expect(res.body.data.daysPerWeek).toBe(4);
  });

  it("não devolve a ficha de outra pessoa", async () => {
    const a = await registrar("pessoaA@test.com");
    const b = await registrar("pessoaB@test.com");
    await request(app)
      .post("/onboarding/profile")
      .set("Authorization", `Bearer ${a.token}`)
      .send(fullProfile);

    const res = await request(app).get("/ficha").set("Authorization", `Bearer ${b.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });
});

describe("PATCH /ficha", () => {
  it("exige autenticação", async () => {
    const res = await request(app).patch("/ficha").send({ goal: "performance" });
    expect(res.status).toBe(401);
  });

  it("edita um campo só e os demais sobrevivem", async () => {
    const { token, userId } = await registrar("editaum@test.com");
    await request(app)
      .post("/onboarding/profile")
      .set("Authorization", `Bearer ${token}`)
      .send(fullProfile);

    const res = await request(app)
      .patch("/ficha")
      .set("Authorization", `Bearer ${token}`)
      .send({ goal: "performance" });

    expect(res.status).toBe(200);
    expect(res.body.data.goal).toBe("performance");
    // Os outros campos, que não foram mandados, sobrevivem intactos.
    expect(res.body.data.daysPerWeek).toBe(4);
    expect(res.body.data.sessionMinutes).toBe(60);
    expect(res.body.data.heightCm).toBe(178);

    const salvo = await Profile.findOne({ user: userId });
    expect(salvo?.goal).toBe("performance");
    expect(salvo?.daysPerWeek).toBe(4);
  });

  it("recusa valor fora da faixa com 400", async () => {
    const { token, userId } = await registrar("foradafaixa@test.com");
    await request(app)
      .post("/onboarding/profile")
      .set("Authorization", `Bearer ${token}`)
      .send(fullProfile);

    const res = await request(app)
      .patch("/ficha")
      .set("Authorization", `Bearer ${token}`)
      .send({ daysPerWeek: 9 });

    expect(res.status).toBe(400);

    const salvo = await Profile.findOne({ user: userId });
    expect(salvo?.daysPerWeek).toBe(4); // nada foi alterado
  });

  it("não deixa editar a ficha de outra pessoa", async () => {
    const a = await registrar("donaDaFicha@test.com");
    const b = await registrar("intrusa@test.com");
    await request(app)
      .post("/onboarding/profile")
      .set("Authorization", `Bearer ${a.token}`)
      .send(fullProfile);

    const res = await request(app)
      .patch("/ficha")
      .set("Authorization", `Bearer ${b.token}`)
      .send({ goal: "performance" });

    // B não tem ficha (o PATCH nunca cria por trás), então recebe 404 — e o
    // ponto real do teste é a linha de baixo: a ficha de A não se move.
    expect(res.status).toBe(404);

    const daDonaA = await Profile.findOne({ user: a.userId });
    expect(daDonaA?.goal).toBe("ganhar_massa"); // intacta
  });

  it("404 ao tentar editar quem não tem ficha nenhuma", async () => {
    const { token } = await registrar("semnenhuma@test.com");
    const res = await request(app)
      .patch("/ficha")
      .set("Authorization", `Bearer ${token}`)
      .send({ goal: "performance" });
    expect(res.status).toBe(404);
  });
});
