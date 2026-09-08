import type mongoose from "mongoose";
import { PersonalRecord } from "../models/PersonalRecord.js";
import { Activity } from "../models/Activity.js";

// Motor de detecção de PR de força (Fase 2c-i). Ver docs/ESPORTES.md §4.4 e §12.

const RANGES: [number, number, string][] = [
  [1, 3, "1-3"],
  [4, 6, "4-6"],
  [7, 10, "7-10"],
  [11, 15, "11-15"],
];

export function repRangeFor(reps: number): string | null {
  for (const [lo, hi, label] of RANGES) if (reps >= lo && reps <= hi) return label;
  return null;
}

/** 1RM estimado (Epley). Só faz sentido de 1 a 12 reps; acima disso a fórmula mente. */
export function estimate1RM(weightKg: number, reps: number): number | null {
  if (reps < 1 || reps > 12) return null;
  return weightKg * (1 + reps / 30);
}

type PrType = "carga_max" | "rm_estimado" | "carga_faixa";

export interface NewPR {
  type: PrType;
  exerciseName: string;
  repRange: string | null;
  value: number;
  previousValue: number | null;
  unit: string;
}

interface Candidate {
  exerciseName: string;
  type: PrType;
  repRange: string | null;
  value: number;
}

interface ReadSet {
  type?: string;
  weightKg?: number;
  reps?: number | null;
}
interface ReadExercise {
  name: string;
  sets?: ReadSet[];
}

interface StrengthActivityLike {
  _id: mongoose.Types.ObjectId;
  sportId: string;
  startedAt: Date;
  payload: unknown;
}

function candidatesFrom(payload: unknown): Candidate[] {
  const exercises = (payload as { exercises?: ReadExercise[] } | null)?.exercises ?? [];
  const out: Candidate[] = [];
  for (const ex of exercises) {
    const valid = (ex.sets ?? []).filter((s) => s.type === "valida" && (s.weightKg ?? 0) > 0);
    if (valid.length === 0) continue;

    // Carga máxima.
    const maxWeight = Math.max(...valid.map((s) => s.weightKg ?? 0));
    out.push({ exerciseName: ex.name, type: "carga_max", repRange: null, value: maxWeight });

    // 1RM estimado (melhor entre as séries de 1–12 reps).
    let best1rm = 0;
    for (const s of valid) {
      const e = estimate1RM(s.weightKg ?? 0, s.reps ?? 0);
      if (e && e > best1rm) best1rm = e;
    }
    if (best1rm > 0) {
      out.push({ exerciseName: ex.name, type: "rm_estimado", repRange: null, value: Math.round(best1rm * 10) / 10 });
    }

    // Maior carga por faixa de repetição.
    const byRange = new Map<string, number>();
    for (const s of valid) {
      const r = repRangeFor(s.reps ?? 0);
      if (!r) continue;
      const w = s.weightKg ?? 0;
      if (w > (byRange.get(r) ?? 0)) byRange.set(r, w);
    }
    for (const [r, w] of byRange) {
      out.push({ exerciseName: ex.name, type: "carga_faixa", repRange: r, value: w });
    }
  }
  return out;
}

/** Só celebra melhoria real: acima de 0,5 kg ou 1% (o que for maior). §12. */
function celebrates(newVal: number, oldVal: number): boolean {
  return newVal - oldVal >= Math.max(0.5, oldVal * 0.01);
}

/**
 * Detecta PRs de força de uma atividade, atualizando a tabela e retornando os
 * recordes CELEBRADOS. Primeira vez de um exercício vira linha de base (não celebra).
 */
export async function detectStrengthPRs(
  userId: mongoose.Types.ObjectId,
  activity: StrengthActivityLike,
  opts: { celebrate?: boolean } = {}
): Promise<NewPR[]> {
  const celebrateEnabled = opts.celebrate ?? true;
  const news: NewPR[] = [];

  for (const c of candidatesFrom(activity.payload)) {
    const existing = await PersonalRecord.findOne({
      user: userId,
      exerciseName: c.exerciseName,
      type: c.type,
      repRange: c.repRange,
    });

    if (!existing) {
      await PersonalRecord.create({
        user: userId,
        sportId: activity.sportId,
        exerciseName: c.exerciseName,
        type: c.type,
        repRange: c.repRange,
        value: c.value,
        unit: "kg",
        achievedAt: activity.startedAt,
        activity: activity._id,
      });
      continue; // linha de base
    }

    if (c.value > existing.value) {
      const prevVal = existing.value;
      const doCelebrate = celebrateEnabled && celebrates(c.value, existing.value);
      existing.previousValue = prevVal;
      existing.previousAchievedAt = existing.achievedAt;
      existing.value = c.value;
      existing.achievedAt = activity.startedAt;
      existing.activity = activity._id;
      await existing.save();
      if (doCelebrate) {
        news.push({ type: c.type, exerciseName: c.exerciseName, repRange: c.repRange, value: c.value, previousValue: prevVal, unit: "kg" });
      }
    }
  }

  return news;
}

/** Reconstrói os PRs de força de um usuário a partir do histórico (linha de base, sem celebrar). */
export async function recomputeStrengthPRs(userId: mongoose.Types.ObjectId): Promise<void> {
  await PersonalRecord.deleteMany({ user: userId });
  const activities = await Activity.find({ user: userId, kind: "strength" }).sort({ startedAt: 1 });
  for (const a of activities) {
    await detectStrengthPRs(userId, a as StrengthActivityLike, { celebrate: false });
  }
}
