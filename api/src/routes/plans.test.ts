import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { setAIProvider } from "../services/ai/index.js";
import { Profile } from "../models/Profile.js";
import type { AIProvider } from "../services/ai/provider.js";

const app = createApp();
let mongod: MongoMemoryServer;
let token: string;
let userId: string;

const planJson = JSON.stringify({
  summary: "Vamos com um full body 3x pra criar base e um déficit leve.",
  workout: {
    split: "Full body 3x",
    daysPerWeek: 3,
    sessions: [
      {
        day: "Dia A",
        focus: "Corpo todo",
        exercises: [
          { name: "Agachamento livre", sets: 3, reps: "8-12", restSeconds: 90, notes: "" },
        ],
      },
    ],
  },
  diet: {
    dailyCalories: 1800,
    macros: { proteinG: 130, carbsG: 180, fatG: 50 },
    meals: [
      { name: "Café da manhã", timeHint: "07:00", items: [{ food: "Ovos", quantity: "3 unidades" }] },
    ],
    notes: "",
  },
  disclaimer: "Este plano é um ponto de partida gerado por IA...",
});

class MockProvider implements AIProvider {
  readonly name = "mock";
  next = planJson;
  async generate(): Promise<string> {
    return this.next;
  }
}
const mock = new MockProvider();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  setAIProvider(mock);

  const reg = await request(app)
    .post("/auth/register")
    .send({ name: "Asafe", email: "asafe@test.com", password: "senha12345" });
  token = reg.body.token;
  userId = reg.body.user.id;

  // Este arquivo testa versionamento de plano, não o gating do freemium
  // (coberto em billing.test.ts). Promove a premium para gerar sem limite.
  await request(app).post("/billing/dev-upgrade").set("Authorization", `Bearer ${token}`);
});

afterAll(async () => {
  setAIProvider(null);
  await mongoose.disconnect();
  await mongod.stop();
});

const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);

async function seedProfile() {
  await Profile.findOneAndUpdate(
    { user: userId },
    {
      user: userId,
      goal: "perder_gordura",
      sex: "feminino",
      age: 32,
      heightCm: 165,
      weightKg: 78,
      experienceLevel: "iniciante",
      daysPerWeek: 3,
      sessionMinutes: 45,
      dietaryRestrictions: ["carne vermelha"],
      injuriesConditions: ["dor no joelho"],
      notes: "",
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

describe("Plans", () => {
  it("exige autenticação", async () => {
    const res = await request(app).post("/plans/generate");
    expect(res.status).toBe(401);
  });

  it("bloqueia geração sem onboarding (sem ficha)", async () => {
    const res = await auth(request(app).post("/plans/generate"));
    expect(res.status).toBe(409);
  });

  it("404 ao buscar plano atual antes de gerar", async () => {
    const res = await auth(request(app).get("/plans/current"));
    expect(res.status).toBe(404);
  });

  it("gera um plano válido a partir da ficha (versão 1)", async () => {
    await seedProfile();
    const res = await auth(request(app).post("/plans/generate"));
    expect(res.status).toBe(201);
    expect(res.body.plan.version).toBe(1);
    expect(res.body.plan.workout.split).toBe("Full body 3x");
    expect(res.body.plan.diet.dailyCalories).toBe(1800);
  });

  it("nova geração incrementa a versão", async () => {
    const res = await auth(request(app).post("/plans/generate"));
    expect(res.status).toBe(201);
    expect(res.body.plan.version).toBe(2);
  });

  it("retorna o plano mais recente em /current", async () => {
    const res = await auth(request(app).get("/plans/current"));
    expect(res.status).toBe(200);
    expect(res.body.plan.version).toBe(2);
  });

  it("JSON inválido da IA vira 502", async () => {
    mock.next = "não é json";
    const res = await auth(request(app).post("/plans/generate"));
    expect(res.status).toBe(502);
    mock.next = planJson;
  });

  it("importa o plano pessoal a partir de texto (nova versão)", async () => {
    const res = await auth(
      request(app)
        .post("/plans/import")
        .send({ text: "Treino ABC: A) supino 4x10; B) agachamento 4x10; C) remada 4x10. Dieta: 2000kcal." })
    );
    expect(res.status).toBe(201);
    expect(res.body.plan.version).toBe(3);
    expect(res.body.plan.workout.split).toBe("Full body 3x");
  });

  it("import rejeita texto muito curto (400)", async () => {
    // Usuário novo para não esbarrar no rate limit do usuário principal.
    const reg = await request(app)
      .post("/auth/register")
      .send({ name: "Import Test", email: "import@test.com", password: "senha12345" });
    const res = await request(app)
      .post("/plans/import")
      .set("Authorization", `Bearer ${reg.body.token}`)
      .send({ text: "oi" });
    expect(res.status).toBe(400);
  });
});
