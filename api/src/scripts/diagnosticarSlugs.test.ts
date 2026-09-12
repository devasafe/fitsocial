import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Activity } from "../models/Activity.js";
import { PersonalRecord } from "../models/PersonalRecord.js";
import { diagnosticar } from "./diagnosticarSlugs.js";

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
  await Activity.deleteMany({});
  await PersonalRecord.deleteMany({});
});

/** Roda o diagnóstico capturando o que ele imprime. */
async function rodar(): Promise<string> {
  const linhas: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...a) => {
    linhas.push(a.join(" "));
  });
  await diagnosticar();
  spy.mockRestore();
  return linhas.join("\n");
}

describe("diagnóstico dos slugs", () => {
  it("não altera nada — é só leitura", async () => {
    await Activity.create({
      user: userId,
      sportId: "musculacao",
      kind: "strength",
      startedAt: new Date(),
      payload: {
        variant: "musculacao",
        exercises: [{ name: "Supino reto", sets: [{ type: "valida", weightKg: 80, reps: 5, done: true }] }],
      },
      metrics: {},
    });
    await PersonalRecord.collection.dropIndex("user_1_exerciseSlug_1_type_1_repRange_1").catch(() => undefined);
    await PersonalRecord.create({
      user: userId,
      exerciseName: "Supino reto",
      type: "carga_max",
      repRange: null,
      value: 80,
      unit: "kg",
    });

    const antesAtividade = await Activity.findOne({}).lean();
    await rodar();
    const depoisAtividade = await Activity.findOne({}).lean();

    // O payload continua sem slug: o diagnóstico não escreve.
    expect((depoisAtividade!.payload as { exercises: { slug?: string }[] }).exercises[0].slug).toBeUndefined();
    expect(JSON.stringify(depoisAtividade)).toBe(JSON.stringify(antesAtividade));
    expect(await PersonalRecord.countDocuments()).toBe(1);
  });

  it("anuncia a fusão dos recordes separados por grafia, e o valor que fica", async () => {
    await PersonalRecord.collection.dropIndex("user_1_exerciseSlug_1_type_1_repRange_1").catch(() => undefined);
    await PersonalRecord.create([
      { user: userId, exerciseName: "Supino reto", type: "carga_max", repRange: null, value: 80, unit: "kg" },
      { user: userId, exerciseName: "supino  RETO", type: "carga_max", repRange: null, value: 95, unit: "kg" },
    ]);

    const saida = await rodar();

    expect(saida).toContain("hoje ................ 2");
    expect(saida).toContain("depois do backfill .. 1");
    expect(saida).toContain("fusões .............. 1");
    expect(saida).toContain("supino_reto");
    expect(saida).toContain("fica: 95kg");
  });

  it("lista o exercício que o catálogo não reconhece", async () => {
    await Activity.create({
      user: userId,
      sportId: "musculacao",
      kind: "strength",
      startedAt: new Date(),
      payload: {
        variant: "musculacao",
        exercises: [{ name: "???", sets: [{ type: "valida", weightKg: 10, reps: 5, done: true }] }],
      },
      metrics: {},
    });

    const saida = await rodar();
    expect(saida).toContain("sem nome utilizável");
  });

  it("sem nada para fazer, não anuncia fusão nenhuma", async () => {
    const saida = await rodar();
    expect(saida).toContain("fusões .............. 0");
    expect(saida).not.toContain("O que vai se juntar");
  });
});
