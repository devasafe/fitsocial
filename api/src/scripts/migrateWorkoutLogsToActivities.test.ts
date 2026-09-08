import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { WorkoutLog } from "../models/WorkoutLog.js";
import { Activity } from "../models/Activity.js";
import { migrateForward, migrateRollback } from "./migrateWorkoutLogsToActivities.js";

let mongod: MongoMemoryServer;
const userId = new mongoose.Types.ObjectId();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await WorkoutLog.create({
    user: userId,
    planVersion: 2,
    sessionDay: "Dia A",
    date: new Date("2026-01-10"),
    entries: [{ exerciseName: "Supino", weightKg: 60, reps: 10 }],
    notes: "bom treino",
  });
  await WorkoutLog.create({
    user: userId,
    planVersion: 2,
    sessionDay: "Dia B",
    date: new Date("2026-01-12"),
    entries: [{ exerciseName: "Esteira", durationMin: 30, distanceKm: 5 }],
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("migração WorkoutLog → Activity", () => {
  it("faz backfill preservando dados, sem tocar nos WorkoutLog", async () => {
    const r = await migrateForward();
    expect(r).toMatchObject({ total: 2, created: 2, skipped: 0 });

    const migradas = await Activity.find({ migratedFrom: { $exists: true } }).sort({ startedAt: 1 });
    expect(migradas).toHaveLength(2);
    expect(migradas[0].kind).toBe("strength");
    expect(migradas[0].sportId).toBe("musculacao");
    expect((migradas[0].planLink as { sessionDay?: string })?.sessionDay).toBe("Dia A");

    // Dados de força e de cardio preservados no payload.
    const payloadA = migradas[0].payload as { exercises: { name: string; sets: { weightKg: number }[] }[] };
    expect(payloadA.exercises[0].name).toBe("Supino");
    expect(payloadA.exercises[0].sets[0].weightKg).toBe(60);
    const payloadB = migradas[1].payload as { exercises: { sets: { distanceKm?: number }[] }[] };
    expect(payloadB.exercises[0].sets[0].distanceKm).toBe(5);

    // WorkoutLog originais intactos.
    expect(await WorkoutLog.countDocuments()).toBe(2);
  });

  it("é idempotente (rodar de novo não duplica)", async () => {
    const r = await migrateForward();
    expect(r).toMatchObject({ created: 0, skipped: 2 });
    expect(await Activity.countDocuments({ migratedFrom: { $exists: true } })).toBe(2);
  });

  it("rollback remove só as atividades migradas e mantém os WorkoutLog", async () => {
    const r = await migrateRollback();
    expect(r.deleted).toBe(2);
    expect(await Activity.countDocuments({ migratedFrom: { $exists: true } })).toBe(0);
    expect(await WorkoutLog.countDocuments()).toBe(2);
  });
});
