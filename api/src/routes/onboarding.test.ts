import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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

// Provider fake: devolve, em ordem, as respostas JSON enfileiradas.
class MockProvider implements AIProvider {
  readonly name = "mock";
  queue: string[] = [];
  async generate(): Promise<string> {
    return this.queue.shift() ?? "{}";
  }
}
const mock = new MockProvider();

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

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  setAIProvider(mock);

  const reg = await request(app)
    .post("/auth/register")
    .send({ name: "Asafe", email: "asafe@test.com", password: "senha12345" });
  token = reg.body.token;
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

describe("Onboarding", () => {
  it("exige autenticação", async () => {
    const res = await request(app).post("/onboarding/message").send({ messages: [] });
    expect(res.status).toBe(401);
  });

  it("retorna a saudação inicial", async () => {
    const res = await auth(request(app).get("/onboarding/greeting"));
    expect(res.status).toBe(200);
    expect(res.body.greeting).toContain("coach");
  });

  it("turno incompleto não conclui o onboarding nem cria ficha", async () => {
    mock.queue = [
      JSON.stringify({ reply: "Qual seu objetivo?", complete: false, profile: null }),
    ];
    const res = await auth(
      request(app).post("/onboarding/message").send({ messages: [{ role: "user", content: "oi" }] })
    );
    expect(res.status).toBe(200);
    expect(res.body.complete).toBe(false);
    expect(res.body.onboardingComplete).toBe(false);
    expect(await Profile.countDocuments()).toBe(0);
  });

  it("turno completo persiste a ficha e conclui o onboarding", async () => {
    mock.queue = [
      JSON.stringify({ reply: "Tudo pronto! 🎉", complete: true, profile: fullProfile }),
    ];
    const res = await auth(
      request(app)
        .post("/onboarding/message")
        .send({ messages: [{ role: "user", content: "respostas..." }] })
    );
    expect(res.status).toBe(200);
    expect(res.body.complete).toBe(true);
    expect(res.body.onboardingComplete).toBe(true);

    const profile = await Profile.findOne();
    expect(profile?.goal).toBe("ganhar_massa");
    expect(profile?.experienceLevel).toBe("iniciante");

    // /auth/me deve refletir onboardingComplete
    const me = await auth(request(app).get("/auth/me"));
    expect(me.body.user.onboardingComplete).toBe(true);
  });

  it("complete=true com ficha inválida NÃO conclui (trata como incompleto)", async () => {
    await Profile.deleteMany({});
    // Novo usuário para não herdar o estado do teste anterior.
    const reg = await request(app)
      .post("/auth/register")
      .send({ name: "Bruno", email: "b@test.com", password: "senha12345" });
    const t2 = reg.body.token as string;

    mock.queue = [
      JSON.stringify({
        reply: "quase lá",
        complete: true,
        profile: { goal: "ganhar_massa", age: 25 }, // faltam campos obrigatórios
      }),
    ];
    const res = await request(app)
      .post("/onboarding/message")
      .set("Authorization", `Bearer ${t2}`)
      .send({ messages: [{ role: "user", content: "x" }] });

    expect(res.status).toBe(200);
    expect(res.body.complete).toBe(false);
    expect(res.body.onboardingComplete).toBe(false);
  });

  it("JSON inválido da IA vira erro tratado (500 com mensagem)", async () => {
    mock.queue = ["isso não é json"];
    const res = await auth(
      request(app).post("/onboarding/message").send({ messages: [{ role: "user", content: "x" }] })
    );
    expect(res.status).toBe(502);
    expect(res.body.error).toBeTruthy();
  });
});
