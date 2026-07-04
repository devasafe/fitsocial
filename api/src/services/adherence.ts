import type { WorkoutLogDoc } from "../models/WorkoutLog.js";
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

/** Calcula total, treinos na semana, streak e último check-in a partir dos logs. */
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

/** Monta um resumo textual de adesão para a IA usar no reajuste do plano. */
export function buildAdherenceSummary(logs: WorkoutLogDoc[], plan: PlanData): string {
  const stats = computeStats(logs);
  const planned = plan.workout.daysPerWeek;

  // Última carga/reps registrada por exercício (progresso).
  const lastByExercise = new Map<string, string>();
  for (const log of logs) {
    for (const e of log.entries) {
      if (!lastByExercise.has(e.exerciseName)) {
        lastByExercise.set(e.exerciseName, `${e.weightKg ?? 0}kg x ${e.reps ?? 0}`);
      }
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
