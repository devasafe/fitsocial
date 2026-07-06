import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { setAIProvider } from "../services/ai/index.js";
import { Profile } from "../models/Profile.js";
import { Plan } from "../models/Plan.js";
import { computeStats } from "../services/adherence.js";
import type { AIProvider } from "../services/ai/provider.js";

const DAY = 24 * 60 * 60 * 1000;

describe("computeStats (streak)", () => {
  it("conta dias consecutivos a partir de hoje", () => {
    const now = Date.now();
    const logs = [
      { date: new Date(now) },
      { date: new Date(now - DAY) },
      { date: new Date(now - 2 * DAY) },
    ];
    const s = computeStats(logs);
    expect(s.total).toBe(3);
    expect(s.streak).toBe(3);
  });

  it("quebra o streak quando há um dia sem treino", () => {
    const now = Date.now();
    const logs = [{ date: new Date(now) }, { date: new Date(now - 3 * DAY) }];
    expect(computeStats(logs).streak).toBe(1);
  });

  it("streak zero sem logs", () => {
    expect(computeStats([]).streak).toBe(0);
  });
});

const planJson = JSON.stringify({
  summary: "Ajuste com progressão de carga.",
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

describe("Check-ins + reajuste", () => {
  const app = createApp();
  let mongod: MongoMemoryServer;
  let token = "";
  let userId = "";

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

  it("registra um treino e reflete nas stats", async () => {
    const res = await auth(
      request(app).post("/checkins").send({
        sessionDay: "Dia A — Peito",
        entries: [{ exerciseName: "Supino", weightKg: 40, reps: 10 }],
      })
    );
    expect(res.status).toBe(201);
    expect(res.body.log.sessionDay).toBe("Dia A — Peito");

    const stats = await auth(request(app).get("/checkins/stats"));
    expect(stats.body.stats.total).toBe(1);
    expect(stats.body.stats.streak).toBe(1);
  });

  it("check-in com compartilhar cria post no feed", async () => {
    const res = await auth(
      request(app).post("/checkins").send({
        sessionDay: "Dia B — Costas",
        entries: [{ exerciseName: "Remada", weightKg: 30, reps: 12 }],
        shareToFeed: true,
      })
    );
    expect(res.body.post).not.toBeNull();

    const feed = await auth(request(app).get("/social/feed"));
    expect(feed.body.posts.some((p: any) => p.text.includes("Dia B"))).toBe(true);
  });

  it("progresso lista a evolução de carga por exercício (ignora cardio)", async () => {
    // Mais um treino de Supino com carga maior + um cardio (sem peso).
    await auth(
      request(app).post("/checkins").send({
        sessionDay: "Dia A — Peito",
        entries: [
          { exerciseName: "Supino", weightKg: 45, reps: 10 },
          { exerciseName: "Esteira" }, // cardio: sem peso, não entra no gráfico
        ],
      })
    );

    const res = await auth(request(app).get("/checkins/progress"));
    expect(res.status).toBe(200);
    const supino = res.body.exercises.find((e: any) => e.name === "Supino");
    expect(supino.points.length).toBe(2); // 40 e depois 45
    expect(supino.points.map((p: any) => p.weightKg)).toEqual([40, 45]);
    expect(res.body.exercises.find((e: any) => e.name === "Esteira")).toBeUndefined();
  });

  it("persiste durationMin/distanceKm numa entry de cardio", async () => {
    const res = await auth(
      request(app).post("/checkins").send({
        sessionDay: "A",
        entries: [{ exerciseName: "Esteira", durationMin: 30, distanceKm: 5 }],
      })
    );
    expect(res.status).toBe(201);

    const hist = await auth(request(app).get("/checkins"));
    const entry = hist.body.logs[0].entries[0];
    expect(entry.durationMin).toBe(30);
    expect(entry.distanceKm).toBe(5);
  });

  it("reajuste é bloqueado para free (402)", async () => {
    const res = await auth(request(app).post("/plans/adjust"));
    expect(res.status).toBe(402);
  });

  it("premium reajusta gerando nova versão", async () => {
    await Plan.create({
      user: userId,
      version: 1,
      summary: "inicial",
      workout: { split: "x", daysPerWeek: 3, sessions: [] },
      diet: { dailyCalories: 1, macros: { proteinG: 1, carbsG: 1, fatG: 1 }, meals: [], notes: "" },
      disclaimer: "x",
    });
    await auth(request(app).post("/billing/dev-upgrade")); // vira premium

    const res = await auth(request(app).post("/plans/adjust"));
    expect(res.status).toBe(201);
    expect(res.body.plan.version).toBe(2);
    expect(res.body.plan.summary).toContain("progressão");
  });
});
