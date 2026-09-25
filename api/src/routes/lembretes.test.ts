import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Activity } from "../models/Activity.js";
import { PushDevice, PushCooldown } from "../models/PushDevice.js";
import { chaveDoDia } from "../utils/dia.js";

vi.mock("../services/push/expo.js", () => ({
  enviarParaExpo: vi.fn(async (msgs: unknown[]) => ({ entregues: msgs.length, invalidos: [] })),
}));

// A rota só existe quando há segredo configurado, e `config/env.ts` lê a
// variável UMA VEZ, no import. Como os imports de ESM são içados para o topo,
// um `vi.stubEnv` aqui rodaria tarde demais: o env já teria sido lido vazio e a
// rota responderia 401 em todo teste. `vi.hoisted` é executado antes deles.
vi.hoisted(() => {
  process.env.LEMBRETES_TOKEN = "segredo-de-teste";
});

const app = createApp();
let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
  delete process.env.LEMBRETES_TOKEN;
});

/**
 * Meio-dia de ontem, no fuso de São Paulo.
 *
 * Sem relógio falso de propósito: `vi.useFakeTimers()` congela os timers de que
 * o servidor HTTP do supertest depende, e a requisição nunca volta — o teste
 * morre por timeout em vez de falhar por asserção. Ancorar a data no dia certo
 * dá o mesmo controle sem parar o relógio.
 */
function ontemAoMeioDia(): Date {
  const DIA = 24 * 60 * 60 * 1000;
  return new Date(`${chaveDoDia(new Date(Date.now() - DIA))}T12:00:00-03:00`);
}

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Activity.deleteMany({}),
    PushDevice.deleteMany({}),
    PushCooldown.deleteMany({}),
  ]);
});

describe("POST /internal/lembretes/sequencia", () => {
  it("dispara os lembretes quando o segredo confere", async () => {
    const u = await User.create({ name: "Ana", email: "ana@teste.com", passwordHash: "x" });
    await PushDevice.create({ user: u._id, token: "ExponentPushToken[ana]", platform: "android" });
    await Activity.create({
      user: u._id,
      sportId: "corrida",
      kind: "endurance",
      startedAt: ontemAoMeioDia(),
      payload: { distanceM: 3000 },
    });

    const r = await request(app)
      .post("/internal/lembretes/sequencia")
      .set("x-lembretes-token", "segredo-de-teste");

    expect(r.status).toBe(200);
    expect(r.body.data.avisados).toBe(1);
  });

  // Sem isto a rota seria um botão de disparar push aberto na internet.
  it("recusa quem não traz o segredo", async () => {
    const r = await request(app).post("/internal/lembretes/sequencia");
    expect(r.status).toBe(401);
  });

  it("recusa segredo errado", async () => {
    const r = await request(app)
      .post("/internal/lembretes/sequencia")
      .set("x-lembretes-token", "chute");
    expect(r.status).toBe(401);
  });
});
