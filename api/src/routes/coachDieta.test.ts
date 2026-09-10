import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { setAIProvider } from "../services/ai/index.js";
import { Profile } from "../models/Profile.js";
import { Plan } from "../models/Plan.js";
import { FoodLog } from "../models/FoodLog.js";
import { CoachMessage } from "../models/CoachMessage.js";
import { User } from "../models/User.js";
import { chaveDoDia } from "../utils/dia.js";
import type { AIProvider, GenerateOptions } from "../services/ai/provider.js";

const app = createApp();
let mongod: MongoMemoryServer;

/** Guarda o prompt que chegou: é ele que diz o que o coach enxergou. */
class EspiaoDeProvider implements AIProvider {
  readonly name = "espiao";
  ultimoSystem = "";
  proximaResposta = JSON.stringify({ reply: "ok", action: "none" });
  async generate(params: GenerateOptions): Promise<string> {
    this.ultimoSystem = params.system ?? "";
    return this.proximaResposta;
  }
}
const espiao = new EspiaoDeProvider();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  setAIProvider(espiao);
});

afterAll(async () => {
  setAIProvider(null);
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Plan.deleteMany({}),
    Profile.deleteMany({}),
    FoodLog.deleteMany({}),
    CoachMessage.deleteMany({}),
  ]);
  espiao.ultimoSystem = "";
  espiao.proximaResposta = JSON.stringify({ reply: "ok", action: "none" });
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let n = 0;
async function registrar(premium = true) {
  n += 1;
  const r = await request(app)
    .post("/auth/register")
    .send({ name: `Pessoa ${n}`, email: `p${n}@teste.com`, password: "senha-bem-longa" });
  const id = new mongoose.Types.ObjectId(r.body.user.id as string);
  if (premium) await User.updateOne({ _id: id }, { $set: { tier: "premium" } });
  await Profile.create({
    user: id,
    goal: "ganhar_massa",
    sex: "masculino",
    age: 30,
    heightCm: 180,
    weightKg: 80,
    experienceLevel: "intermediario",
    daysPerWeek: 4,
    sessionMinutes: 60,
    dietaryRestrictions: [],
    injuriesConditions: [],
  });
  return { token: r.body.token as string, id };
}

const DIETA = {
  dailyCalories: 2200,
  macros: { proteinG: 150, carbsG: 220, fatG: 70 },
  meals: [
    { name: "Almoço", timeHint: "12:00", items: [{ food: "Arroz integral", quantity: "100g" }, { food: "Frango grelhado", quantity: "150g" }] },
  ],
  notes: "Beba água.",
};

const TREINO = {
  split: "Full body 3x",
  daysPerWeek: 3,
  sessions: [{ day: "A", focus: "Geral", exercises: [{ name: "Agachamento", sets: 3, reps: "10", restSeconds: 60, notes: "" }] }],
};

function criarPlano(user: mongoose.Types.ObjectId, partes: { workout?: unknown; diet?: unknown }) {
  return Plan.create({
    user,
    version: 1,
    summary: "estratégia",
    workout: partes.workout ?? null,
    diet: partes.diet ?? null,
    disclaimer: "Aviso.",
  });
}

const falar = (t: string, content = "e a dieta?") =>
  request(app).post("/coach/messages").set(auth(t)).send({ content });

describe("O coach enxerga a dieta", () => {
  it("recebe a dieta refeição por refeição, não só as calorias", async () => {
    const u = await registrar();
    await criarPlano(u.id, { diet: DIETA });

    await falar(u.token).expect(200);

    // Antes o coach só recebia "dieta 2200 kcal". "Posso trocar o arroz do
    // almoço?" era pergunta feita a quem não sabe o que tem no almoço.
    expect(espiao.ultimoSystem).toContain("Arroz integral 100g");
    expect(espiao.ultimoSystem).toContain("Frango grelhado 150g");
    expect(espiao.ultimoSystem).toContain("150g proteína");
  });

  it("recebe o que já foi comido hoje, e quanto sobra", async () => {
    const u = await registrar();
    await criarPlano(u.id, { diet: DIETA });
    await FoodLog.create({
      user: u.id, date: chaveDoDia(), meal: "almoco", name: "Marmita",
      kcal: 800, proteinG: 50, carbsG: 80, fatG: 25,
    });

    await falar(u.token).expect(200);

    expect(espiao.ultimoSystem).toContain("COMEU HOJE: 800 kcal");
    // É o que transforma "posso comer isso no jantar?" em pergunta respondível.
    expect(espiao.ultimoSystem).toContain("Restam 1400 kcal");
  });

  it("não inventa dieta para quem não tem", async () => {
    const u = await registrar();
    await criarPlano(u.id, { workout: TREINO });

    await falar(u.token).expect(200);

    expect(espiao.ultimoSystem).not.toContain("DIETA ATUAL");
    expect(espiao.ultimoSystem).toContain("NÃO tem dieta montada");
  });
});

describe("Reajustar uma metade sem tocar na outra", () => {
  it("ajuste de dieta não dispara ajuste de treino", async () => {
    const u = await registrar();
    await criarPlano(u.id, { workout: TREINO, diet: DIETA });
    espiao.proximaResposta = JSON.stringify({ reply: "vou refazer", action: "adjust_diet" });

    const r = await falar(u.token).expect(200);

    expect(r.body.dietAdjustPending).toBe(true);
    expect(r.body.adjustPending).toBe(false);
  });

  it("quem não tem treino não recebe ajuste de treino", async () => {
    const u = await registrar();
    await criarPlano(u.id, { diet: DIETA });
    espiao.proximaResposta = JSON.stringify({ reply: "vou ajustar", action: "adjust_plan" });

    const r = await falar(u.token).expect(200);

    // Depois que as metades passaram a existir uma sem a outra, reajustar "o
    // plano" de quem só tem dieta geraria um treino que ninguém pediu.
    expect(r.body.adjustPending).toBe(false);
    expect(r.body.dietAdjustPending).toBe(false);
  });

  it("quem não tem dieta não recebe ajuste de dieta", async () => {
    const u = await registrar();
    await criarPlano(u.id, { workout: TREINO });
    espiao.proximaResposta = JSON.stringify({ reply: "vou refazer", action: "adjust_diet" });

    const r = await falar(u.token).expect(200);

    expect(r.body.dietAdjustPending).toBe(false);
  });

  it("no plano grátis, nenhuma das duas ações passa", async () => {
    const u = await registrar(false);
    await criarPlano(u.id, { workout: TREINO, diet: DIETA });
    espiao.proximaResposta = JSON.stringify({ reply: "vou refazer", action: "adjust_diet" });

    const r = await falar(u.token).expect(200);

    expect(r.body.dietAdjustPending).toBe(false);
    expect(r.body.premiumRequired).toBe(true);
  });

  it("o prompt avisa qual metade NÃO existe, para o coach não oferecer o que não dá", async () => {
    const u = await registrar();
    await criarPlano(u.id, { diet: DIETA });

    await falar(u.token).expect(200);

    expect(espiao.ultimoSystem).toContain("não tem treino montado aqui");
  });
});
