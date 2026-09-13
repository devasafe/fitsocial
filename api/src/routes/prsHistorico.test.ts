import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { Activity } from "../models/Activity.js";
import { User } from "../models/User.js";
import { PersonalRecord } from "../models/PersonalRecord.js";
import { PersonalRecordEvent } from "../models/PersonalRecordEvent.js";
import { recomputeUserPRs } from "../services/prEngine.js";

const DIA = 24 * 60 * 60 * 1000;

describe("Histórico de conquistas", () => {
  const app = createApp();
  let mongod: MongoMemoryServer;
  let token = "";
  let userId = "";

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    const reg = await request(app)
      .post("/auth/register")
      .send({ name: "Asafe", email: "asafe@test.com", password: "senha12345" });
    token = reg.body.token;
    userId = reg.body.user.id;

    // Conta paga: aqui se testa a LINHA DO TEMPO das conquistas, não o gate.
    // O grátis vê só a última semana, e isso tem arquivo próprio
    // (`gatesDoPlano.test.ts`).
    await User.updateOne(
      { _id: userId },
      { $set: { premiumSource: "admin", premiumUntil: null } }
    );
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await Activity.deleteMany({});
    await PersonalRecord.deleteMany({});
    await PersonalRecordEvent.deleteMany({});
  });

  async function supino(weightKg: number, diasAtras: number, reps = 5) {
    const r = await request(app)
      .post("/activities")
      .set("Authorization", `Bearer ${token}`)
      .send({
        sportId: "musculacao",
        kind: "strength",
        startedAt: new Date(Date.now() - diasAtras * DIA).toISOString(),
        payload: {
          variant: "musculacao",
          exercises: [{ name: "Supino reto", sets: [{ type: "valida", weightKg, reps, done: true }] }],
        },
      });
    expect(r.status).toBe(201);
    return r.body;
  }

  async function historico(query = "") {
    const r = await request(app)
      .get(`/prs/historico${query}`)
      .set("Authorization", `Bearer ${token}`);
    expect(r.status).toBe(200);
    return r.body;
  }

  it("a primeira vez não vira conquista — é linha de base", async () => {
    await supino(80, 10);
    const body = await historico();
    expect(body.data).toEqual([]);
  });

  it("superar o próprio recorde vira conquista, com o valor anterior", async () => {
    await supino(80, 10);
    await supino(90, 2);

    const body = await historico("?slug=supino_reto&limit=100");
    const carga = body.data.filter((e: { type: string }) => e.type === "carga_max");

    expect(carga).toHaveLength(1);
    expect(carga[0]).toMatchObject({
      exerciseSlug: "supino_reto",
      exerciseName: "Supino reto",
      value: 90,
      previousValue: 80,
      unit: "kg",
    });
  });

  it("guarda cada recorde batido, não só o último", async () => {
    await supino(80, 30);
    await supino(90, 20);
    await supino(100, 10);

    const body = await historico("?slug=supino_reto&limit=100");
    const carga = body.data.filter((e: { type: string }) => e.type === "carga_max");

    // Duas conquistas: 80→90 e 90→100. O 80 foi a linha de base.
    expect(carga.map((e: { value: number }) => e.value)).toEqual([100, 90]);
    expect(carga.map((e: { previousValue: number }) => e.previousValue)).toEqual([90, 80]);
  });

  it("vem da mais recente para trás", async () => {
    await supino(80, 30);
    await supino(90, 20);
    await supino(100, 10);

    const body = await historico("?limit=100");
    const datas = body.data.map((e: { achievedAt: string }) => new Date(e.achievedAt).getTime());
    expect(datas).toEqual([...datas].sort((a, b) => b - a));
  });

  it("pagina por cursor sem repetir nem pular conquista", async () => {
    for (let i = 0; i < 6; i++) await supino(80 + i * 5, 30 - i * 3);

    const p1 = await historico("?limit=3");
    expect(p1.data).toHaveLength(3);
    expect(p1.meta.nextCursor).toBeTruthy();

    const p2 = await historico(`?limit=3&cursor=${encodeURIComponent(p1.meta.nextCursor)}`);

    const ids = [...p1.data, ...p2.data].map((e: { id: string }) => e.id);
    expect(new Set(ids).size).toBe(ids.length);

    const todas = await historico("?limit=100");
    expect(todas.data.slice(0, 6).map((e: { id: string }) => e.id)).toEqual(ids);
  });

  it("filtra por exercício", async () => {
    await supino(80, 30);
    await supino(90, 20);
    for (const peso of [100, 120]) {
      await request(app)
        .post("/activities")
        .set("Authorization", `Bearer ${token}`)
        .send({
          sportId: "musculacao",
          kind: "strength",
          startedAt: new Date(Date.now() - (peso === 100 ? 15 : 5) * DIA).toISOString(),
          payload: {
            variant: "musculacao",
            exercises: [{ name: "Agachamento livre", sets: [{ type: "valida", weightKg: peso, reps: 5, done: true }] }],
          },
        });
    }

    const body = await historico("?slug=agachamento_livre&limit=100");
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((e: { exerciseSlug: string }) => e.exerciseSlug === "agachamento_livre")).toBe(true);
  });

  it("não mostra a conquista de outra pessoa", async () => {
    await supino(80, 10);
    await supino(90, 2);

    const outro = await request(app)
      .post("/auth/register")
      .send({ name: "Outro", email: "outro2@test.com", password: "senha12345" });
    const r = await request(app)
      .get("/prs/historico")
      .set("Authorization", `Bearer ${outro.body.token}`);

    expect(r.body.data).toEqual([]);
  });

  it("exige autenticação", async () => {
    const r = await request(app).get("/prs/historico");
    expect(r.status).toBe(401);
  });

  it("recompute reconstrói a linha do tempo sem duplicar", async () => {
    await supino(80, 30);
    await supino(90, 20);
    await supino(100, 10);

    const antes = await historico("?limit=100");
    await recomputeUserPRs(new mongoose.Types.ObjectId(userId));
    const depois = await historico("?limit=100");

    expect(depois.data).toHaveLength(antes.data.length);
    expect(depois.data.map((e: { value: number }) => e.value)).toEqual(
      antes.data.map((e: { value: number }) => e.value)
    );
  });
});
