import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../models/User.js";
import { Activity } from "../models/Activity.js";
import { PushDevice, PushCooldown } from "../models/PushDevice.js";
import { avisarSequenciasEmRisco } from "./lembretes.js";

// O transporte é o limite: o que importa provar é QUEM recebe.
const enviados: { to: string; title: string; body: string }[] = [];
vi.mock("./push/expo.js", () => ({
  enviarParaExpo: vi.fn(async (msgs: { to: string; title: string; body: string }[]) => {
    enviados.push(...msgs);
    return { entregues: msgs.length, invalidos: [] };
  }),
}));

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
  vi.useRealTimers();
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Activity.deleteMany({}),
    PushDevice.deleteMany({}),
    PushCooldown.deleteMany({}),
  ]);
  enviados.length = 0;
});

/** Uma pessoa com aparelho registrado — sem isso não há para onde mandar. */
async function pessoa(nome: string) {
  const u = await User.create({
    name: nome,
    email: `${nome}@teste.com`,
    passwordHash: "x",
  });
  await PushDevice.create({ user: u._id, token: `ExponentPushToken[${nome}]`, platform: "android" });
  return u;
}

async function treinou(u: { _id: mongoose.Types.ObjectId }, quando: string) {
  await Activity.create({
    user: u._id,
    sportId: "corrida",
    kind: "endurance",
    startedAt: new Date(quando),
    payload: { distanceM: 3000 },
  });
}

describe("avisarSequenciasEmRisco", () => {
  it("avisa quem treinou ontem e ainda não treinou hoje", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T20:00:00-03:00"));

    const ana = await pessoa("ana");
    await treinou(ana, "2026-09-23T10:00:00-03:00");
    await treinou(ana, "2026-09-24T10:00:00-03:00");

    const r = await avisarSequenciasEmRisco();

    expect(r.avisados).toBe(1);
    expect(enviados).toHaveLength(1);
    // A sequência que está em jogo precisa aparecer: "não perca" sem número não
    // diz o que se perde.
    expect(enviados[0].body).toContain("2");
    vi.useRealTimers();
  });

  it("não avisa quem já treinou hoje", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T20:00:00-03:00"));

    const bruno = await pessoa("bruno");
    await treinou(bruno, "2026-09-24T10:00:00-03:00");
    await treinou(bruno, "2026-09-25T07:00:00-03:00");

    const r = await avisarSequenciasEmRisco();

    expect(r.avisados).toBe(0);
    expect(enviados).toHaveLength(0);
    vi.useRealTimers();
  });

  it("não avisa quem não tem sequência para perder", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T20:00:00-03:00"));

    const caio = await pessoa("caio");
    await treinou(caio, "2026-09-01T10:00:00-03:00");

    const r = await avisarSequenciasEmRisco();

    expect(r.avisados).toBe(0);
    expect(enviados).toHaveLength(0);
    vi.useRealTimers();
  });

  // Rodar o lembrete duas vezes na mesma noite — por engano, por retentativa do
  // agendador — não pode cobrar a pessoa duas vezes.
  it("não avisa a mesma pessoa duas vezes no mesmo dia", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T20:00:00-03:00"));

    const duda = await pessoa("duda");
    await treinou(duda, "2026-09-24T10:00:00-03:00");

    await avisarSequenciasEmRisco();
    const segunda = await avisarSequenciasEmRisco();

    expect(segunda.avisados).toBe(0);
    expect(enviados).toHaveLength(1);
    vi.useRealTimers();
  });
});
