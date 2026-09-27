import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Activity } from "../models/Activity.js";
import { Follow } from "../models/Follow.js";

/**
 * Quem seguir.
 *
 * O feed "Seguindo" nasce vazio para todo mundo porque ninguém é levado a
 * seguir ninguém — não existe sugestão em lugar nenhum do app. Com 71 contas,
 * a lista não precisa de recomendação sofisticada: precisa existir, mostrar
 * gente VIVA (seguir quem sumiu não enche feed nenhum) e dizer POR QUE está
 * sugerindo.
 */

const app = createApp();
let mongod: MongoMemoryServer;
const DIA = 24 * 60 * 60 * 1000;

async function registrar(nome: string) {
  const r = await request(app)
    .post("/auth/register")
    .send({ name: nome, email: `${nome}@teste.com`, password: "senha-bem-longa" });
  return { token: r.body.token as string, id: r.body.user.id as string };
}

async function treinou(userId: string, diasAtras: number, vezes = 1) {
  for (let i = 0; i < vezes; i++) {
    await Activity.create({
      user: new mongoose.Types.ObjectId(userId),
      sportId: "corrida",
      kind: "endurance",
      startedAt: new Date(Date.now() - diasAtras * DIA - i * 60_000),
      payload: { distanceM: 3000 },
    });
  }
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Activity.deleteMany({}), Follow.deleteMany({})]);
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("GET /social/sugestoes", () => {
  it("sugere quem treinou nos últimos dias", async () => {
    const eu = await registrar("eu");
    const ativa = await registrar("ativa");
    await treinou(ativa.id, 2, 3);

    const r = await request(app).get("/social/sugestoes").set(auth(eu.token));

    expect(r.status).toBe(200);
    const ids = (r.body.data as { id: string }[]).map((p) => p.id);
    expect(ids).toContain(ativa.id);
  });

  it("não sugere quem você já segue", async () => {
    const eu = await registrar("eu");
    const amiga = await registrar("amiga");
    await treinou(amiga.id, 1, 2);
    await request(app).post(`/social/users/${amiga.id}/follow`).set(auth(eu.token)).expect(200);

    const r = await request(app).get("/social/sugestoes").set(auth(eu.token));

    const ids = (r.body.data as { id: string }[]).map((p) => p.id);
    expect(ids).not.toContain(amiga.id);
  });

  it("não sugere você mesmo", async () => {
    const eu = await registrar("eu");
    await treinou(eu.id, 1, 5);

    const r = await request(app).get("/social/sugestoes").set(auth(eu.token));

    const ids = (r.body.data as { id: string }[]).map((p) => p.id);
    expect(ids).not.toContain(eu.id);
  });

  // Seguir quem sumiu não enche feed nenhum — e é a sugestão que faz a pessoa
  // concluir que o app é deserto.
  it("não sugere quem parou de treinar faz tempo", async () => {
    const eu = await registrar("eu");
    const sumida = await registrar("sumida");
    await treinou(sumida.id, 90, 10);

    const r = await request(app).get("/social/sugestoes").set(auth(eu.token));

    const ids = (r.body.data as { id: string }[]).map((p) => p.id);
    expect(ids).not.toContain(sumida.id);
  });

  it("põe quem treinou mais na frente", async () => {
    const eu = await registrar("eu");
    const pouca = await registrar("pouca");
    const muita = await registrar("muita");
    await treinou(pouca.id, 3, 1);
    await treinou(muita.id, 3, 6);

    const r = await request(app).get("/social/sugestoes").set(auth(eu.token));

    const ids = (r.body.data as { id: string }[]).map((p) => p.id);
    expect(ids.indexOf(muita.id)).toBeLessThan(ids.indexOf(pouca.id));
  });

  // Lista de nomes soltos é lista fria: o motivo é o que transforma "quem é
  // essa pessoa?" em "ah, ela treina mesmo".
  it("cada sugestão diz por que está ali", async () => {
    const eu = await registrar("eu");
    const ativa = await registrar("ativa");
    await treinou(ativa.id, 2, 4);

    const r = await request(app).get("/social/sugestoes").set(auth(eu.token));

    const p = (r.body.data as { id: string; motivo: string }[]).find((x) => x.id === ativa.id);
    expect(p?.motivo).toBeTruthy();
    expect(p?.motivo).toContain("4");
  });

  it("exige autenticação", async () => {
    expect((await request(app).get("/social/sugestoes")).status).toBe(401);
  });
});
