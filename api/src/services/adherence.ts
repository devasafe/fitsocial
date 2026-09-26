import type { PlanData } from "../models/Plan.js";
import { chaveDoDia } from "../utils/dia.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * O dia de um treino, no fuso de São Paulo.
 *
 * Era `toISOString()`, ou seja, UTC — e São Paulo está três horas atrás, então
 * todo treino entre 21h e meia-noite era contado no dia seguinte. Quem treina
 * depois do trabalho tinha a sequência contada errada nos dois sentidos: dois
 * treinos no mesmo dia viravam dois dias, e ontem-à-noite + hoje-cedo viravam
 * um só.
 *
 * Passava despercebido enquanto a sequência era um número na tela. Deixa de
 * passar no instante em que ela tem consequência.
 *
 * As chaves continuam "yyyy-mm-dd", então a aritmética de dias abaixo (que
 * compara duas chaves como datas) continua valendo: a diferença entre dois dias
 * seguidos é sempre 86400000, porque a data pura não carrega hora.
 */
const dayKey = chaveDoDia;

export interface CheckInStats {
  total: number;
  week: number; // últimos 7 dias
  streak: number; // dias consecutivos com pelo menos 1 treino
  lastCheckIn: Date | null;
  /** A maior sequência já feita. É o que dá o que reconquistar depois de perder. */
  melhorStreak: number;
  /** Tem sequência viva e ainda não treinou hoje — o único caso que justifica cobrar. */
  emRisco: boolean;
}

/** Calcula total, treinos na semana, streak e último check-in a partir das datas. */
export function computeStats(logs: { date: Date }[]): CheckInStats {
  if (logs.length === 0) {
    return { total: 0, week: 0, streak: 0, lastCheckIn: null, melhorStreak: 0, emRisco: false };
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

  // A maior corrida de dias consecutivos em toda a história, e não só a atual.
  let melhorStreak = 0;
  let corrente = 0;
  for (let i = 0; i < days.length; i++) {
    if (i === 0) {
      corrente = 1;
    } else {
      const anterior = new Date(days[i - 1]).getTime();
      const atual = new Date(days[i]).getTime();
      corrente = anterior - atual === DAY_MS ? corrente + 1 : 1;
    }
    if (corrente > melhorStreak) melhorStreak = corrente;
  }

  // Cobrar só faz sentido quando há o que perder E ainda dá para salvar. Quem
  // já treinou hoje não pode ser avisado: é o caminho mais curto para a pessoa
  // desligar todos os avisos e não voltar.
  const emRisco = streak > 0 && days[0] !== today;

  const lastCheckIn = logs.reduce((a, b) => (a.date > b.date ? a : b)).date;
  return { total: logs.length, week, streak, lastCheckIn, melhorStreak, emRisco };
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
