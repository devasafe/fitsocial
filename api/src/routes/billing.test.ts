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
let token = "";
let userId = "";

const planJson = JSON.stringify({
  summary: "Plano de teste",
  workout: {
    split: "Full body 3x",
    daysPerWeek: 3,
    sessions: [
      { day: "A", focus: "Geral", exercises: [{ name: "Agachamento", sets: 3, reps: "10", restSeconds: 60, notes: "" }] },
    ],
  },
  diet: {
    dailyCalories: 1800,
    macros: { proteinG: 130, carbsG: 180, fatG: 50 },
    meals: [{ name: "Café", timeHint: "07:00", items: [{ food: "Ovos", quantity: "3" }] }],
    notes: "",
  },
  disclaimer: "Aviso.",
});

class MockProvider implements AIProvider {
  readonly name = "mock";
  async generate(): Promise<string> {
    return planJson;
  }
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  setAIProvider(new MockProvider());

  const reg = await request(app)
    .post("/auth/register")
    .send({ name: "Asafe", email: "asafe@test.com", password: "senha12345" });
  token = reg.body.token;
  userId = reg.body.user.id;

  await Profile.create({
    user: userId,
    goal: "ganhar_massa",
    sex: "masculino",
    age: 25,
    heightCm: 178,
    weightKg: 74,
    experienceLevel: "iniciante",
    daysPerWeek: 3,
    sessionMinutes: 60,
    dietaryRestrictions: [],
    injuriesConditions: [],
    notes: "",
  });
});

afterAll(async () => {
  setAIProvider(null);
  await mongoose.disconnect();
  await mongod.stop();
});

const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);

describe("Freemium (gating + billing)", () => {
  it("grátis gera o primeiro plano (v1)", async () => {
    const res = await auth(request(app).post("/plans/generate"));
    expect(res.status).toBe(201);
    expect(res.body.plan.version).toBe(1);
  });

  it("grátis é bloqueado ao regenerar (402)", async () => {
    const res = await auth(request(app).post("/plans/generate"));
    expect(res.status).toBe(402);
  });

  it("dev-upgrade promove a premium", async () => {
    const res = await auth(request(app).post("/billing/dev-upgrade"));
    expect(res.status).toBe(200);
    expect(res.body.user.tier).toBe("premium");
  });

  it("premium regenera o plano (v2)", async () => {
    const res = await auth(request(app).post("/plans/generate"));
    expect(res.status).toBe(201);
    expect(res.body.plan.version).toBe(2);
  });

  it("webhook de EXPIRATION rebaixa para free", async () => {
    const res = await request(app)
      .post("/billing/webhook")
      .send({ event: { type: "EXPIRATION", app_user_id: userId } });
    expect(res.status).toBe(200);

    const me = await auth(request(app).get("/auth/me"));
    expect(me.body.user.tier).toBe("free");
  });

  it("webhook de INITIAL_PURCHASE promove para premium", async () => {
    await request(app)
      .post("/billing/webhook")
      .send({ event: { type: "INITIAL_PURCHASE", app_user_id: userId } });

    const me = await auth(request(app).get("/auth/me"));
    expect(me.body.user.tier).toBe("premium");
  });
});
