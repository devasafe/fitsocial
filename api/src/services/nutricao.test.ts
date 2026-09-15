import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Plan } from "../models/Plan.js";
import { alvosPorDia } from "./nutricao.js";

let mongod: MongoMemoryServer;
const user = new mongoose.Types.ObjectId();

const dieta = (kcal: number) => ({
  dailyCalories: kcal,
  macros: { proteinG: 150, carbsG: 200, fatG: 60 },
  meals: [{ name: "Café", timeHint: "", items: [{ food: "Ovos", quantity: "2" }] }],
  notes: "",
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Plan.deleteMany({});
});

describe("O alvo que valia em cada dia", () => {
  it("dia anterior a qualquer dieta nao tem alvo", async () => {
    await Plan.create({
      user, version: 1, summary: "plano", workout: null, diet: dieta(2000),
      disclaimer: "aviso", createdAt: new Date("2026-09-10T12:00:00Z"),
    });

    const alvos = await alvosPorDia(user, ["2026-09-08", "2026-09-11"]);

    expect(alvos.get("2026-09-08")).toBeNull();
    expect(alvos.get("2026-09-11")?.kcal).toBe(2000);
  });

  it("meta que mudou no meio da janela nao reescreve o passado", async () => {
    await Plan.create({
      user, version: 1, summary: "plano", workout: null, diet: dieta(2000),
      disclaimer: "aviso", createdAt: new Date("2026-09-01T12:00:00Z"),
    });
    await Plan.create({
      user, version: 2, summary: "plano", workout: null, diet: dieta(1700),
      disclaimer: "aviso", createdAt: new Date("2026-09-10T12:00:00Z"),
    });

    const alvos = await alvosPorDia(user, ["2026-09-05", "2026-09-10", "2026-09-12"]);

    // O dia 5 foi vivido com meta de 2000: julgá-lo por 1700 seria inventar uma
    // falha que nao aconteceu.
    expect(alvos.get("2026-09-05")?.kcal).toBe(2000);
    expect(alvos.get("2026-09-10")?.kcal).toBe(1700);
    expect(alvos.get("2026-09-12")?.kcal).toBe(1700);
  });

  it("plano sem dieta nao conta como troca de alvo", async () => {
    await Plan.create({
      user, version: 1, summary: "plano", workout: null, diet: dieta(2000),
      disclaimer: "aviso", createdAt: new Date("2026-09-01T12:00:00Z"),
    });
    // Prescricao de treino: cria versao nova e PRESERVA a dieta (routes/pro.ts).
    await Plan.create({
      user, version: 2, summary: "plano", workout: { split: "AB", daysPerWeek: 2, sessions: [] },
      diet: null, disclaimer: "aviso", createdAt: new Date("2026-09-05T12:00:00Z"),
    });

    expect((await alvosPorDia(user, ["2026-09-07"])).get("2026-09-07")?.kcal).toBe(2000);
  });

  it("nao enxerga a dieta de outra pessoa", async () => {
    await Plan.create({
      user: new mongoose.Types.ObjectId(), version: 1, summary: "plano", workout: null,
      diet: dieta(3000), disclaimer: "aviso", createdAt: new Date("2026-09-01T12:00:00Z"),
    });

    expect((await alvosPorDia(user, ["2026-09-07"])).get("2026-09-07")).toBeNull();
  });
});
