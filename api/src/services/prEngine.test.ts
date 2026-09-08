import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Activity } from "../models/Activity.js";
import { PersonalRecord } from "../models/PersonalRecord.js";
import { estimate1RM, repRangeFor, detectStrengthPRs } from "./prEngine.js";

let mongod: MongoMemoryServer;
const userId = new mongoose.Types.ObjectId();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
beforeEach(async () => {
  await PersonalRecord.deleteMany({});
  await Activity.deleteMany({});
});

async function logSupino(weightKg: number, reps: number) {
  const activity = await Activity.create({
    user: userId,
    sportId: "musculacao",
    kind: "strength",
    startedAt: new Date(),
    payload: {
      variant: "musculacao",
      exercises: [{ name: "Supino", sets: [{ type: "valida", weightKg, reps, done: true }] }],
    },
    metrics: {},
  });
  return detectStrengthPRs(userId, activity);
}

describe("estimate1RM (Epley)", () => {
  it("estima 1RM só para 1–12 reps", () => {
    expect(estimate1RM(100, 5)).toBeCloseTo(100 * (1 + 5 / 30));
    expect(estimate1RM(100, 1)).toBeCloseTo(100 * (1 + 1 / 30));
    expect(estimate1RM(100, 13)).toBeNull();
    expect(estimate1RM(100, 0)).toBeNull();
  });
});

describe("repRangeFor", () => {
  it("classifica a faixa de repetições", () => {
    expect(repRangeFor(2)).toBe("1-3");
    expect(repRangeFor(6)).toBe("4-6");
    expect(repRangeFor(10)).toBe("7-10");
    expect(repRangeFor(15)).toBe("11-15");
    expect(repRangeFor(20)).toBeNull();
  });
});

describe("detectStrengthPRs", () => {
  it("primeira vez é linha de base: registra o PR mas não celebra", async () => {
    const news = await logSupino(60, 8);
    expect(news).toHaveLength(0); // nada celebrado
    const cargaMax = await PersonalRecord.findOne({ exerciseName: "Supino", type: "carga_max" });
    expect(cargaMax?.value).toBe(60);
  });

  it("celebra quando bate a carga máxima com margem real, guardando o anterior", async () => {
    await logSupino(60, 8);
    const news = await logSupino(65, 6);
    const cargaMaxPR = news.find((p) => p.type === "carga_max");
    expect(cargaMaxPR).toBeTruthy();
    expect(cargaMaxPR?.value).toBe(65);
    expect(cargaMaxPR?.previousValue).toBe(60);
  });

  it("não celebra melhora abaixo do limiar (0,5 kg / 1%)", async () => {
    await logSupino(100, 5);
    const news = await logSupino(100.3, 5); // +0,3 kg < 1 kg (1%)
    expect(news.find((p) => p.type === "carga_max")).toBeUndefined();
    // mas o número foi atualizado silenciosamente
    const pr = await PersonalRecord.findOne({ exerciseName: "Supino", type: "carga_max" });
    expect(pr?.value).toBeCloseTo(100.3);
  });

  it("detecta 1RM estimado como recorde próprio", async () => {
    await logSupino(60, 8); // baseline 1RM ~76
    const news = await logSupino(80, 5); // 1RM ~93.3 > baseline
    expect(news.find((p) => p.type === "rm_estimado")).toBeTruthy();
  });
});
