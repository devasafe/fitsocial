import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { WorkoutLog } from "../models/WorkoutLog.js";
import { Activity, type StrengthPayload } from "../models/Activity.js";
import { computeStrengthMetrics } from "../services/activityMetrics.js";

// Migração reversível: copia cada WorkoutLog para uma Activity(kind strength),
// preservando os dados (inclusive cardio) e a ligação com o plano. Os WorkoutLog
// NÃO são apagados — servem de fonte até a aposentadoria do modelo. Idempotente
// via o campo migratedFrom. Ver docs/ARQUITETURA.md §5.3.

export async function migrateForward(): Promise<{ total: number; created: number; skipped: number }> {
  const logs = await WorkoutLog.find({});
  let created = 0;
  let skipped = 0;

  for (const log of logs) {
    if (await Activity.exists({ migratedFrom: log._id })) {
      skipped++;
      continue;
    }

    const payload: StrengthPayload = {
      variant: "musculacao",
      exercises: log.entries.map((e, i) => ({
        name: e.exerciseName,
        order: i,
        sets: [
          {
            type: "valida",
            weightKg: e.weightKg ?? 0,
            reps: e.reps ?? null,
            durationMin: e.durationMin ?? null,
            distanceKm: e.distanceKm ?? null,
            done: true,
          },
        ],
      })),
    };

    await Activity.create({
      user: log.user,
      sportId: "musculacao",
      kind: "strength",
      startedAt: log.date,
      durationSec: 0,
      visibility: "followers",
      notes: log.notes ?? "",
      planLink: { planVersion: log.planVersion ?? 0, sessionDay: log.sessionDay },
      payload,
      metrics: computeStrengthMetrics(payload),
      migratedFrom: log._id,
    });
    created++;
  }

  return { total: logs.length, created, skipped };
}

export async function migrateRollback(): Promise<{ deleted: number }> {
  const r = await Activity.deleteMany({ migratedFrom: { $exists: true, $ne: null } });
  return { deleted: r.deletedCount ?? 0 };
}

// CLI: `tsx src/scripts/migrateWorkoutLogsToActivities.ts [--rollback]`
if (process.argv[1]?.includes("migrateWorkoutLogsToActivities")) {
  const rollback = process.argv.includes("--rollback");
  connectDB()
    .then(async () => {
      if (rollback) {
        const r = await migrateRollback();
        console.log(`[migrate] rollback: ${r.deleted} atividades migradas removidas`);
      } else {
        const r = await migrateForward();
        console.log(`[migrate] ${r.created} criadas, ${r.skipped} já existiam (de ${r.total} logs)`);
      }
      await mongoose.disconnect();
    })
    .catch((err) => {
      console.error("[migrate] falhou:", err);
      process.exit(1);
    });
}
