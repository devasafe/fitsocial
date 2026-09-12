import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Activity } from "../models/Activity.js";
import { PersonalRecord } from "../models/PersonalRecord.js";
import { backfillForward, backfillRollback } from "./backfillExerciseSlugs.js";

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

/** Grava um treino como o app ANTIGO gravava: sem slug nenhum. */
async function treinoAntigo(name: string, weightKg: number, quando: string) {
  return Activity.create({
    user: userId,
    sportId: "musculacao",
    kind: "strength",
    startedAt: new Date(quando),
    payload: {
      variant: "musculacao",
      exercises: [{ name, sets: [{ type: "valida", weightKg, reps: 5, done: true }] }],
    },
    metrics: {},
  });
}

async function slugsDe(id: mongoose.Types.ObjectId): Promise<(string | undefined)[]> {
  const a = await Activity.findById(id).lean();
  const ex = (a?.payload as { exercises?: { slug?: string }[] }).exercises ?? [];
  return ex.map((e) => e.slug);
}

describe("backfill dos slugs de exercício", () => {
  it("preenche o slug dos treinos antigos", async () => {
    const a = await treinoAntigo("Supino reto", 80, "2026-09-01");
    const r = await backfillForward();

    expect(r.atualizadas).toBe(1);
    expect(await slugsDe(a._id)).toEqual(["supino_reto"]);
  });

  it("é idempotente: rodar de novo não muda nada", async () => {
    const a = await treinoAntigo("Supino reto", 80, "2026-09-01");
    await backfillForward();
    const segunda = await backfillForward();

    expect(segunda.atualizadas).toBe(0);
    expect(await slugsDe(a._id)).toEqual(["supino_reto"]);
  });

  it("funde recordes que estavam separados só pela grafia", async () => {
    // O estado que existe hoje em produção: dois recordes do mesmo exercício,
    // gravados quando a chave ainda era o nome. O índice novo não existe lá
    // ainda — é justamente o backfill que vai poder criá-lo — então o teste
    // precisa derrubá-lo antes, senão o próprio setup é rejeitado.
    await PersonalRecord.collection
      .dropIndex("user_1_exerciseSlug_1_type_1_repRange_1")
      .catch(() => undefined);

    await treinoAntigo("Supino reto", 80, "2026-09-01");
    await treinoAntigo("supino  reto", 90, "2026-09-08");
    await PersonalRecord.create([
      { user: userId, exerciseName: "Supino reto", type: "carga_max", repRange: null, value: 80, unit: "kg" },
      { user: userId, exerciseName: "supino  reto", type: "carga_max", repRange: null, value: 90, unit: "kg" },
    ]);

    await backfillForward();

    const prs = await PersonalRecord.find({ user: userId, type: "carga_max" });
    expect(prs).toHaveLength(1);
    expect(prs[0].exerciseSlug).toBe("supino_reto");
    // O valor certo é o melhor dos dois, reconstruído do histórico.
    expect(prs[0].value).toBe(90);

    // E o índice único passou a ser o do slug — é o backfill que fecha a troca.
    const indices = await PersonalRecord.collection.indexes();
    expect(indices.some((i) => i.name === "user_1_exerciseSlug_1_type_1_repRange_1")).toBe(true);
    expect(indices.some((i) => i.name === "user_1_exerciseName_1_type_1_repRange_1")).toBe(false);
  });

  it("não inventa slug para exercício sem nome utilizável", async () => {
    const a = await Activity.create({
      user: userId,
      sportId: "musculacao",
      kind: "strength",
      startedAt: new Date(),
      payload: { variant: "musculacao", exercises: [{ name: "---", sets: [{ type: "valida", weightKg: 10, reps: 5 }] }] },
      metrics: {},
    });
    const r = await backfillForward();

    expect(r.semSlug).toBe(1);
    expect(await slugsDe(a._id)).toEqual([undefined]);
  });

  it("aguenta payload torto sem parar a migração dos outros", async () => {
    await Activity.collection.insertOne({
      user: userId,
      sportId: "musculacao",
      kind: "strength",
      startedAt: new Date(),
      payload: { exercises: "isto não é uma lista" },
      metrics: {},
    });
    const bom = await treinoAntigo("Agachamento livre", 100, "2026-09-02");

    const r = await backfillForward();

    expect(r.atualizadas).toBe(1);
    expect(await slugsDe(bom._id)).toEqual(["agachamento_livre"]);
  });

  it("o rollback tira o slug de todos", async () => {
    const a = await treinoAntigo("Supino reto", 80, "2026-09-01");
    await backfillForward();
    await backfillRollback();

    expect(await slugsDe(a._id)).toEqual([undefined]);
  });
});
