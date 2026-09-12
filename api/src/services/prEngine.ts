import type mongoose from "mongoose";
import { PersonalRecord } from "../models/PersonalRecord.js";
import { Activity } from "../models/Activity.js";
import { normalizarWod, fecharScore, chaveDoMovimento } from "./crossfit.js";
import { resolverBenchmark } from "./benchmarks.js";
import { slugify, slugDoExercicio } from "./slug.js";

// Motor de detecção de PR (Fase 2c). Ver docs/ESPORTES.md §4.4, §5.3, §7.3, §12.
// Força e distância: "maior é melhor". Tempo: "menor é melhor". Aulas/horas:
// totais acumulados que celebram ao cruzar marcos.

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

/** 1RM estimado (Epley). Só faz sentido de 1 a 12 reps. */
export function estimate1RM(weightKg: number, reps: number): number | null {
  if (reps < 1 || reps > 12) return null;
  return weightKg * (1 + reps / 30);
}

type PrType =
  | "carga_max"
  | "rm_estimado"
  | "carga_faixa"
  | "best_dist"
  | "best_time"
  | "aulas"
  | "horas"
  | "wod_time"
  | "wod_score"
  | "wod_load"
  /** Maior sequência sem quebrar num movimento: 35 double-unders seguidos. */
  | "skill_reps";

const MIN_TYPES = new Set<PrType>(["best_time", "wod_time"]); // menor é melhor
const MILESTONES: Partial<Record<PrType, number[]>> = {
  aulas: [50, 100, 250, 500, 1000],
  horas: [50, 100, 250, 500, 1000],
};

/** Maior marco cruzado no intervalo (oldV, newV], ou null. */
export function crossedMilestone(type: string, oldV: number, newV: number): number | null {
  const ms = MILESTONES[type as PrType];
  if (!ms) return null;
  let hit: number | null = null;
  for (const m of ms) if (oldV < m && newV >= m) hit = m;
  return hit;
}

export interface NewPR {
  type: PrType;
  exerciseName: string;
  repRange: string | null;
  value: number;
  previousValue: number | null;
  unit: string;
  milestone?: number;
}

interface Candidate {
  exerciseName: string;
  /** A identidade do exercicio. Sem ela, vale o slug do proprio nome. */
  exerciseSlug?: string;
  type: PrType;
  repRange: string | null;
  value: number;
  unit: string;
}

interface ActivityLike {
  _id: mongoose.Types.ObjectId;
  sportId: string;
  kind: string;
  startedAt: Date;
  durationSec?: number;
  payload: unknown;
}

// ---- Candidatos por formato ----

interface ReadSet {
  type?: string;
  weightKg?: number;
  reps?: number | null;
}
interface ReadExercise {
  name: string;
  sets?: ReadSet[];
  /** Gravado no salvamento por `preencherSlugs`. Falta nos treinos antigos. */
  slug?: string | null;
  exerciseId?: string | null;
}

function strengthCandidates(payload: unknown): Candidate[] {
  const exercises = (payload as { exercises?: ReadExercise[] } | null)?.exercises ?? [];
  const out: Candidate[] = [];
  for (const ex of exercises) {
    const valid = (ex.sets ?? []).filter((s) => s.type === "valida" && (s.weightKg ?? 0) > 0);
    if (valid.length === 0) continue;

    // Uma vez por exercicio: o treino antigo nao tem `slug` gravado, e resolver
    // aqui e o que faz o historico dele se juntar ao dos novos.
    const exerciseSlug = ex.slug || slugDoExercicio(ex.name, ex.exerciseId);

    const maxWeight = Math.max(...valid.map((s) => s.weightKg ?? 0));
    out.push({ exerciseName: ex.name, exerciseSlug, type: "carga_max", repRange: null, value: maxWeight, unit: "kg" });

    let best1rm = 0;
    for (const s of valid) {
      const e = estimate1RM(s.weightKg ?? 0, s.reps ?? 0);
      if (e && e > best1rm) best1rm = e;
    }
    if (best1rm > 0) {
      out.push({ exerciseName: ex.name, exerciseSlug, type: "rm_estimado", repRange: null, value: Math.round(best1rm * 10) / 10, unit: "kg" });
    }

    const byRange = new Map<string, number>();
    for (const s of valid) {
      const r = repRangeFor(s.reps ?? 0);
      if (!r) continue;
      const w = s.weightKg ?? 0;
      if (w > (byRange.get(r) ?? 0)) byRange.set(r, w);
    }
    for (const [r, w] of byRange) {
      out.push({ exerciseName: ex.name, exerciseSlug, type: "carga_faixa", repRange: r, value: w, unit: "kg" });
    }
  }
  return out;
}

// Alvos de distância por esporte (metros) para o "melhor tempo".
const ENDURANCE_TARGETS: Record<string, number[]> = {
  corrida: [1000, 5000, 10000, 21100, 42200],
  trail: [5000, 10000, 21100],
  esteira: [1000, 5000, 10000],
  caminhada: [5000, 10000],
  ciclismo: [10000, 20000, 40000],
};
function distLabel(m: number): string {
  if (m === 21100) return "21k";
  if (m === 42200) return "42k";
  return `${Math.round(m / 1000)}k`;
}

function enduranceCandidates(activity: ActivityLike): Candidate[] {
  const payload = activity.payload as
    | { distanceM?: number; bestEfforts?: { distanceM: number; timeSec: number }[] }
    | null;
  const distanceM = payload?.distanceM ?? 0;
  const durationSec = activity.durationSec ?? 0;
  const out: Candidate[] = [];

  if (distanceM > 0) {
    out.push({ exerciseName: activity.sportId, type: "best_dist", repRange: null, value: distanceM, unit: "m" });
  }

  if (payload?.bestEfforts && payload.bestEfforts.length > 0) {
    // Track de GPS: melhor trecho real por janela deslizante (§5.3).
    for (const e of payload.bestEfforts) {
      out.push({ exerciseName: activity.sportId, type: "best_time", repRange: distLabel(e.distanceM), value: e.timeSec, unit: "s" });
    }
  } else if (distanceM > 0 && durationSec > 0) {
    // Registro manual: tempo estimado pelo pace médio.
    for (const target of ENDURANCE_TARGETS[activity.sportId] ?? []) {
      if (target > distanceM) continue;
      const impliedTime = Math.round(durationSec * (target / distanceM));
      out.push({ exerciseName: activity.sportId, type: "best_time", repRange: distLabel(target), value: impliedTime, unit: "s" });
    }
  }
  return out;
}

interface WodPayloadLike {
  name?: string;
  scoreType?: string;
  level?: string;
  resultTimeSec?: number | null;
  resultRounds?: number | null;
  resultReps?: number | null;
  resultLoadKg?: number | null;
  strengthBlock?: unknown;
}

/**
 * Candidatos de um treino de CrossFit.
 *
 * Lê blocos — o formato antigo chega aqui já convertido por `normalizarWod`, de
 * modo que existe um caminho só.
 */
function wodCandidates(payload: unknown): Candidate[] {
  const wod = normalizarWod(payload);
  const out: Candidate[] = [];

  // Em dupla ou equipe o resultado é do TIME, não da pessoa.
  //
  // Vinte Chest-to-Bar revezados entre dois não é o mesmo esforço que vinte
  // sozinho, e um "Relay" derrubaria o recorde individual de quem treina
  // sério. Não gerar recorde é o mesmo tratamento que o time cap recebe: o
  // treino fica no histórico, só não compete.
  //
  // No v2 isto era por bloco (`metcon.equipe`); agora o tamanho do time é do
  // treino inteiro, então a porta fecha uma vez só.
  if (wod.tamanhoDoTime > 1) return out;

  // Todo bloco com resultado concorre — e nenhum sem.
  //
  // Antes a pergunta era "isso é metcon?", e dependia de um rótulo escolhido
  // no cadastro: quem registrasse o WOD como "skill" não ganhava recorde
  // nenhum. Aquecimento não tem resultado, logo não entra aqui sozinho.
  for (const metcon of wod.blocos) {
    const score = metcon.resultado;
    if (!score) continue;

    // Identidade do recorde. O slug do catálogo tem preferência — é ele que
    // faz "Fran", "fran" e "FRAN " serem o mesmo histórico.
    //
    // Nome livre TAMBÉM gera recorde, normalizado. Eu tinha exigido só o slug,
    // e isso silenciosamente parou de atualizar o recorde de quem chama o WOD
    // de "Treino A" — que é quase todo mundo. Quebrar o histórico de quem já
    // usa é pior que o risco teórico de dois treinos parecidos dividirem um
    // nome genérico: esse risco é escolha de quem nomeia, o outro é bug.
    const chave =
      metcon.benchmark?.slug ??
      resolverBenchmark(metcon.nome)?.slug ??
      chaveDoMovimento(metcon.nome ?? "");
    if (!chave) continue;

    // Estourou o cap: o resultado é um parcial. Deixar competir faria "4 rounds
    // no cap de 20min" derrubar um "terminou em 17:34" do quadro de recordes.
    if (score.capado) continue;

    // Score customizado ("soma do pior round") não compete com nada: só quem
    // escreveu sabe o que o número quer dizer.
    if (score.tipo === "customizado") continue;

    const nivel = metcon.escala.nivel;
    const fechado = fecharScore(score, metcon.movimentos);

    if (score.tipo === "tempo" && (score.tempoSec ?? 0) > 0) {
      out.push({ exerciseName: chave, type: "wod_time", repRange: nivel, value: score.tempoSec as number, unit: "s" });
    } else if (score.tipo === "carga" && (score.cargaKg ?? 0) > 0) {
      out.push({ exerciseName: chave, type: "wod_load", repRange: nivel, value: score.cargaKg as number, unit: "kg" });
    } else if (score.tipo === "rounds_reps" && (score.rounds ?? 0) > 0) {
      // AMRAP continua medido em ROUNDS no recorde.
      //
      // Eu tinha trocado para o total de reps canônico, sob a MESMA chave de
      // recorde — então um "15 rounds" já gravado passava a ser comparado
      // contra "150 reps" e virava um "novo recorde" falso, com a lista
      // misturando as duas unidades.
      //
      // O valor canônico continua existindo e continua certo: ele vive no
      // histórico de benchmark (metrics.wod.scoreValor), que é novo e não tem
      // legado. Recorde fala a língua de quem treina ("fiz 15 rounds");
      // o gráfico ordena por trabalho total.
      out.push({
        exerciseName: chave,
        type: "wod_score",
        repRange: nivel,
        value: score.rounds as number,
        unit: "rounds",
      });
    } else if (fechado.valor != null && fechado.valor > 0) {
      out.push({
        exerciseName: chave,
        type: "wod_score",
        repRange: nivel,
        value: fechado.valor,
        unit: score.tipo === "distancia" ? "m" : "reps",
      });
    }
  }

  return out;
}

async function classCandidates(
  userId: mongoose.Types.ObjectId,
  activity: ActivityLike
): Promise<Candidate[]> {
  const filter = { user: userId, kind: "class", sportId: activity.sportId };
  const count = await Activity.countDocuments(filter);
  const agg = await Activity.aggregate<{ total: number }>([
    { $match: filter },
    { $group: { _id: null, total: { $sum: "$durationSec" } } },
  ]);
  const hours = Math.round(((agg[0]?.total ?? 0) / 3600) * 10) / 10;
  return [
    { exerciseName: activity.sportId, type: "aulas", repRange: null, value: count, unit: "aulas" },
    { exerciseName: activity.sportId, type: "horas", repRange: null, value: hours, unit: "h" },
  ];
}

// ---- Aplicação de um candidato ----

function meaningfulMax(newV: number, oldV: number): boolean {
  return newV - oldV >= Math.max(0.5, oldV * 0.01);
}

async function applyCandidate(
  userId: mongoose.Types.ObjectId,
  activity: ActivityLike,
  c: Candidate,
  celebrateEnabled: boolean
): Promise<NewPR | null> {
  // A chave e o slug. Os geradores que nao passam um (endurance, aulas, wod)
  // ja mandam nome canonico, entao o slug do proprio nome serve.
  const exerciseSlug = c.exerciseSlug || slugify(c.exerciseName);

  const existing = await PersonalRecord.findOne({
    user: userId,
    exerciseSlug,
    type: c.type,
    repRange: c.repRange,
  });

  if (!existing) {
    await PersonalRecord.create({
      user: userId,
      sportId: activity.sportId,
      exerciseName: c.exerciseName,
      exerciseSlug,
      type: c.type,
      repRange: c.repRange,
      value: c.value,
      unit: c.unit,
      achievedAt: activity.startedAt,
      activity: activity._id,
    });
    return null; // linha de base
  }

  const isMin = MIN_TYPES.has(c.type);
  const improved = isMin ? c.value < existing.value : c.value > existing.value;
  if (!improved) return null;

  const prevVal = existing.value;
  // O rotulo acompanha a grafia mais recente; a identidade (slug) nao muda.
  existing.exerciseName = c.exerciseName;
  existing.previousValue = prevVal;
  existing.previousAchievedAt = existing.achievedAt;
  existing.value = c.value;
  existing.achievedAt = activity.startedAt;
  existing.activity = activity._id;
  await existing.save();

  if (!celebrateEnabled) return null;

  // Marcos (aulas/horas): só celebra ao cruzar um limiar.
  const milestone = crossedMilestone(c.type, prevVal, c.value);
  if (MILESTONES[c.type]) {
    return milestone
      ? { type: c.type, exerciseName: c.exerciseName, repRange: c.repRange, value: c.value, previousValue: prevVal, unit: c.unit, milestone }
      : null;
  }

  // Tempo: melhora de ao menos 1s. Demais: 0,5 / 1%.
  const worthy = isMin ? prevVal - c.value >= 1 : meaningfulMax(c.value, prevVal);
  if (!worthy) return null;
  return { type: c.type, exerciseName: c.exerciseName, repRange: c.repRange, value: c.value, previousValue: prevVal, unit: c.unit };
}

async function applyAll(
  userId: mongoose.Types.ObjectId,
  activity: ActivityLike,
  candidates: Candidate[],
  celebrateEnabled: boolean
): Promise<NewPR[]> {
  const news: NewPR[] = [];
  for (const c of candidates) {
    const pr = await applyCandidate(userId, activity, c, celebrateEnabled);
    if (pr) news.push(pr);
  }
  return news;
}

// ---- API pública ----

/** Detecta PRs de uma atividade, despachando por formato. Retorna os celebrados. */
export async function detectPRs(
  userId: mongoose.Types.ObjectId,
  activity: ActivityLike,
  opts: { celebrate?: boolean } = {}
): Promise<NewPR[]> {
  const celebrate = opts.celebrate ?? true;
  switch (activity.kind) {
    case "strength":
      return applyAll(userId, activity, strengthCandidates(activity.payload), celebrate);
    case "endurance":
      return applyAll(userId, activity, enduranceCandidates(activity), celebrate);
    case "class":
      return applyAll(userId, activity, await classCandidates(userId, activity), celebrate);
    case "wod":
      return applyAll(userId, activity, wodCandidates(activity.payload), celebrate);
    default:
      return [];
  }
}

/** Mantido para compatibilidade: detecção só de força. */
export async function detectStrengthPRs(
  userId: mongoose.Types.ObjectId,
  activity: ActivityLike,
  opts: { celebrate?: boolean } = {}
): Promise<NewPR[]> {
  return applyAll(userId, activity, strengthCandidates(activity.payload), opts.celebrate ?? true);
}

/** Reconstrói os PRs de um usuário a partir do histórico (linha de base, sem celebrar). */
export async function recomputeUserPRs(userId: mongoose.Types.ObjectId): Promise<void> {
  await PersonalRecord.deleteMany({ user: userId });
  const activities = await Activity.find({
    user: userId,
    kind: { $in: ["strength", "endurance", "class", "wod"] },
  }).sort({ startedAt: 1 });
  for (const a of activities) {
    await detectPRs(userId, a as unknown as ActivityLike, { celebrate: false });
  }
}
