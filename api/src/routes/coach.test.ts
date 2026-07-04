import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { setAIProvider } from "../services/ai/index.js";
import { Profile } from "../models/Profile.js";
import { Plan } from "../models/Plan.js";
import type { AIProvider } from "../services/ai/provider.js";

const app = createApp();
let mongod: MongoMemoryServer;
let token = "";
let userId = "";

// Mock com fila: cada generate() consome a próxima resposta.
class MockProvider implements AIProvider {
  readonly name = "mock";
  queue: string[] = [];
  async generate(): Promise<string> {
    return this.queue.shift() ?? JSON.stringify({ reply: "ok", action: "none" });
  }
}
const mock = new MockProvider();

const planJson = JSON.stringify({
  summary: "Ajuste com progressão.",
  workout: { split: "Full body 3x", daysPerWeek: 3, sessions: [{ day: "A", focus: "Geral", exercises: [{ name: "Agachamento", sets: 3, reps: "10", restSeconds: 60, notes: "" }] }] },
  diet: { dailyCalories: 1800, macros: { proteinG: 130, carbsG: 180, fatG: 50 }, meals: [{ name: "Café", timeHint: "07:00", items: [{ food: "Ovos", quantity: "3" }] }], notes: "" },
  disclaimer: "Aviso.",
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  setAIProvider(mock);
  const reg = await request(app).post("/auth/register").send({ name: "Asafe", email: "asafe@test.com", password: "senha12345" });
  token = reg.body.token;
  userId = reg.body.user.id;
});

afterAll(async () => {
  setAIProvider(null);
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(() => {
  mock.queue = [];
});

const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);

describe("Coach chat", () => {
  it("histórico vazio traz saudação", async () => {
    const res = await auth(request(app).get("/coach/messages"));
    expect(res.status).toBe(200);
    expect(res.body.greeting).toContain("coach");
    expect(res.body.messages).toEqual([]);
  });

  it("conversa salva mensagens e responde", async () => {
    mock.queue = [JSON.stringify({ reply: "Entendo, vamos com calma!", action: "none" })];
    const res = await auth(request(app).post("/coach/messages").send({ content: "tô desanimado" }));
    expect(res.status).toBe(200);
    expect(res.body.reply).toContain("calma");
    expect(res.body.planAdjusted).toBe(false);

    const hist = await auth(request(app).get("/coach/messages"));
    expect(hist.body.messages.length).toBe(2); // user + assistant
    expect(hist.body.messages[0].content).toBe("tô desanimado");
  });

  it("resposta em texto puro (não-JSON) não quebra — vira reply", async () => {
    mock.queue = ["Claro! Você pode sim, é só me contar seu plano."];
    const res = await auth(request(app).post("/coach/messages").send({ content: "consigo inserir meu plano?" }));
    expect(res.status).toBe(200);
    expect(res.body.reply).toContain("plano");
    expect(res.body.planAdjusted).toBe(false);
  });

  it("ação de reajuste em conta grátis sinaliza premiumRequired", async () => {
    mock.queue = [JSON.stringify({ reply: "Posso reajustar, mas é Premium.", action: "adjust_plan" })];
    const res = await auth(request(app).post("/coach/messages").send({ content: "muda meu plano" }));
    expect(res.body.premiumRequired).toBe(true);
    expect(res.body.planAdjusted).toBe(false);
  });

  it("premium reajusta o plano pela conversa", async () => {
    await Profile.create({
      user: userId, goal: "ganhar_massa", sex: "masculino", age: 25, heightCm: 178, weightKg: 74,
      experienceLevel: "iniciante", daysPerWeek: 3, sessionMinutes: 60,
      dietaryRestrictions: [], injuriesConditions: [], notes: "",
    });
    await Plan.create({
      user: userId, version: 1, summary: "inicial",
      workout: { split: "x", daysPerWeek: 3, sessions: [] },
      diet: { dailyCalories: 1, macros: { proteinG: 1, carbsG: 1, fatG: 1 }, meals: [], notes: "" },
      disclaimer: "x",
    });
    await auth(request(app).post("/billing/dev-upgrade")); // vira premium

    // 1ª resposta: coach decide reajustar. 2ª: JSON do plano gerado.
    mock.queue = [
      JSON.stringify({ reply: "Fechado, reajustei seu plano!", action: "adjust_plan" }),
      planJson,
    ];
    const res = await auth(request(app).post("/coach/messages").send({ content: "tá difícil, ajusta" }));
    expect(res.body.planAdjusted).toBe(true);

    const plan = await Plan.findOne({ user: userId }).sort({ version: -1 });
    expect(plan?.version).toBe(2);
    expect(plan?.summary).toContain("progressão");
  });
});
