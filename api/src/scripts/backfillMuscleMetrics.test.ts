import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Activity } from "../models/Activity.js";
import { backfillForward, backfillRollback } from "./backfillMuscleMetrics.js";

let mongod: MongoMemoryServer;
const userId = new mongoose.Types.ObjectId();

/** Um treino como os que já estão gravados: sem os campos novos em metrics. */
async function treinoAntigo(exercises: Record<string, unknown>[], metrics = {}) {
  return Activity.create({
    user: userId,
    sportId: "musculacao",
    kind: "strength",
    durationSec: 1800,
    payload: { variant: "musculacao", exercises },
    metrics: { volumeTotalKg: 1000, seriesValidas: 3, ...metrics },
  });
}

const serie = { type: "valida", weightKg: 80, reps: 10, done: true };

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
});

describe("backfill de músculos", () => {
  it("preenche os músculos sem encostar no que já estava em metrics", async () => {
    const treino = await treinoAntigo([
      { name: "Agachamento livre", sets: [serie, serie] },
      { name: "Panturrilha em pé", sets: [serie] },
    ]);

    const r = await backfillForward();
    expect(r.atualizadas).toBe(1);

    const depois = await Activity.findById(treino._id).lean();
    const m = depois!.metrics as Record<string, unknown>;
    expect(m.musculos).toEqual(["Quadríceps", "Panturrilha"]);
    expect(m.seriesPorGrupo).toEqual({ "Quadríceps": 2, Panturrilha: 1 });
    // O que já existia continua exatamente como estava.
    expect(m.volumeTotalKg).toBe(1000);
    expect(m.seriesValidas).toBe(3);
  });

  it("é idempotente — rodar de novo dá o mesmo resultado", async () => {
    await treinoAntigo([{ name: "Supino reto", sets: [serie] }]);

    await backfillForward();
    const primeira = await Activity.findOne({}).lean();

    const segunda = await backfillForward();
    expect(segunda.atualizadas).toBe(1);

    const depois = await Activity.findOne({}).lean();
    expect(depois!.metrics).toEqual(primeira!.metrics);
  });

  it("não grava lista vazia quando nenhum exercício resolve", async () => {
    await treinoAntigo([{ name: "aquele aparelho do canto", sets: [serie] }]);

    const r = await backfillForward();
    expect(r.atualizadas).toBe(0);
    expect(r.semMusculo).toBe(1);

    // Campo ausente diz "não sei"; lista vazia diria "sei que não é nada" — e a
    // leitura pararia de tentar resolver pelo nome.
    const depois = await Activity.findOne({}).lean();
    expect((depois!.metrics as Record<string, unknown>).musculos).toBeUndefined();
  });

  it("o rollback tira só os campos novos", async () => {
    await treinoAntigo([{ name: "Supino reto", sets: [serie] }]);
    await backfillForward();

    const r = await backfillRollback();
    expect(r.limpas).toBe(1);

    const depois = await Activity.findOne({}).lean();
    const m = depois!.metrics as Record<string, unknown>;
    expect(m.musculos).toBeUndefined();
    expect(m.seriesPorGrupo).toBeUndefined();
    expect(m.volumeTotalKg).toBe(1000);
    expect(m.seriesValidas).toBe(3);
  });

  it("um treino torto não impede a migração dos que vêm depois", async () => {
    // O payload é `Mixed`: o que está gravado nunca passou pelo zod de hoje.
    // Sem guarda, o primeiro exercício sem `sets` abortava o backfill inteiro e
    // tudo que vinha depois no cursor ficava sem preencher, sem retomada.
    await treinoAntigo([{ name: "Supino reto" } as Record<string, unknown>]);
    const bom = await treinoAntigo([{ name: "Agachamento livre", sets: [serie] }]);

    const r = await backfillForward();
    expect(r.total).toBe(2);
    expect(r.falharam).toBe(0);

    const depois = await Activity.findById(bom._id).lean();
    expect((depois!.metrics as Record<string, unknown>).musculos).toEqual(["Quadríceps"]);
  });

  it("não mexe em treino que não é de força", async () => {
    await Activity.create({
      user: userId,
      sportId: "corrida",
      kind: "endurance",
      durationSec: 1800,
      payload: { distanceM: 5000 },
      metrics: { distanceKm: 5 },
    });

    const r = await backfillForward();
    expect(r.total).toBe(0);

    const depois = await Activity.findOne({}).lean();
    expect(depois!.metrics).toEqual({ distanceKm: 5 });
  });
});
