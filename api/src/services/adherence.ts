import type { PlanData } from "../models/Plan.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10); // yyyy-mm-dd (UTC)
}

export interface CheckInStats {
  total: number;
  week: number; // últimos 7 dias
  streak: number; // dias consecutivos com pelo menos 1 treino
  lastCheckIn: Date | null;
}

/** Calcula total, treinos na semana, streak e último check-in a partir das datas. */
export function computeStats(logs: { date: Date }[]): CheckInStats {
  if (logs.length === 0) {
    return { total: 0, week: 0, streak: 0, lastCheckIn: null };
  }

  const now = Date.now();
  const week = logs.filter((l) => now - l.date.getTime() <= 7 * DAY_MS).length;

  // Dias distintos com treino, do mais recente ao mais antigo.
  const days = [...new Set(logs.map((l) => dayKey(l.date)))].sort().reverse();

  // Streak: conta dias consecutivos partindo de hoje ou de ontem.
  const today = dayKey(new Date(now));
  const yesterday = dayKey(new Date(now - DAY_MS));
  let streak = 0;
  if (days[0] === today || days[0] === yesterday) {
    streak = 1;
    for (let i = 1; i < days.length; i++) {
      const prev = new Date(days[i - 1]).getTime();
      const cur = new Date(days[i]).getTime();
      if (prev - cur === DAY_MS) streak++;
      else break;
    }
  }

  const lastCheckIn = logs.reduce((a, b) => (a.date > b.date ? a : b)).date;
  return { total: logs.length, week, streak, lastCheckIn };
}

// ---- Adesão a partir de atividades (Activity) ----

interface StrengthSetLike {
  weightKg?: number;
  reps?: number | null;
  type?: string;
}
interface StrengthExerciseLike {
  name: string;
  sets: StrengthSetLike[];
}
interface StrengthPayloadLike {
  exercises?: StrengthExerciseLike[];
}
export interface AdherenceActivity {
  startedAt: Date;
  kind: string;
  payload: unknown;
}

/**
 * Monta um resumo textual de adesão para a IA usar no reajuste do plano.
 * Recebe as atividades já ordenadas da mais recente para a mais antiga.
 */
export function buildAdherenceSummary(activities: AdherenceActivity[], plan: PlanData): string {
  const stats = computeStats(activities.map((a) => ({ date: a.startedAt })));
  const planned = plan.workout.daysPerWeek;

  // Última carga/reps registrada por exercício (progresso).
  const lastByExercise = new Map<string, string>();
  for (const a of activities) {
    if (a.kind !== "strength") continue;
    const payload = a.payload as StrengthPayloadLike | null;
    if (!payload?.exercises) continue;
    for (const ex of payload.exercises) {
      if (lastByExercise.has(ex.name)) continue;
      const set = ex.sets.find((s) => s.type === "valida") ?? ex.sets[0];
      lastByExercise.set(ex.name, `${set?.weightKg ?? 0}kg x ${set?.reps ?? 0}`);
    }
  }

  const progress = [...lastByExercise.entries()]
    .slice(0, 20)
    .map(([name, load]) => `  - ${name}: ${load}`)
    .join("\n");

  return `ADESÃO DO USUÁRIO (últimos treinos):
- Treinos concluídos nos últimos 7 dias: ${stats.week} (planejado: ${planned}/semana)
- Sequência atual (streak): ${stats.streak} dia(s)
- Total de treinos registrados: ${stats.total}
Últimas cargas registradas por exercício:
${progress || "  (nenhuma carga registrada ainda)"}`;
}
