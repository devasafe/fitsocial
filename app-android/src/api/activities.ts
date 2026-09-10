import type { PayloadDeCrossfit } from "./crossfit";
import { apiFetch } from "./client";

export interface StrengthSetInput {
  type?: "aquecimento" | "valida" | "drop" | "falha" | "rest_pause" | "backoff";
  weightKg?: number;
  reps?: number | null;
  holdSec?: number | null;
}
export interface StrengthExerciseInput {
  name: string;
  sets: StrengthSetInput[];
}

interface CommonInput {
  sportId: string;
  title?: string;
  durationSec?: number;
  visibility?: "private" | "followers" | "public";
  notes?: string;
  shareToFeed?: boolean;
  caption?: string;
  startedAt?: string;
  /** RPE de 1 a 10. A API já aceitava; o cliente é que não expunha. */
  perceivedEffort?: number;
  feeling?: "otimo" | "bom" | "normal" | "ruim" | "pessimo";
}

export type CreateActivityInput =
  // CrossFit em blocos. Convive com o formato antigo de wod, que continua
  // abaixo — existe APK instalado mandando ele.
  | (CommonInput & { kind: "wod"; payload: PayloadDeCrossfit })
  | (CommonInput & { kind: "strength"; payload: { variant?: string; exercises: StrengthExerciseInput[] } })
  | (CommonInput & {
      kind: "endurance";
      payload: {
        subType?: string;
        distanceM: number;
        elevationGainM?: number | null;
        points?: { lat: number; lng: number; t?: number; ele?: number }[];
      };
    })
  | (CommonInput & {
      kind: "class";
      payload: { modality: string; sessionType?: string; gi?: boolean | null; rounds?: number | null };
    })
  | (CommonInput & {
      kind: "generic";
      payload: {
        activityName: string;
        description?: string | null;
        customMetrics?: { label: string; value: string; unit?: string | null }[];
      };
    })
  | (CommonInput & {
      kind: "wod";
      payload: {
        name: string;
        scoreType: "for_time" | "amrap" | "emom" | "rft" | "max_load" | "for_reps" | "tabata" | "chipper";
        level?: "rx" | "scaled" | "adaptado";
        resultTimeSec?: number | null;
        resultRounds?: number | null;
        resultReps?: number | null;
        resultLoadKg?: number | null;
        description?: string | null;
        strengthBlock?: { variant?: string; exercises: StrengthExerciseInput[] };
        // Composição do WOD, movimento a movimento (tudo opcional exceto o nome).
        movements?: { name: string; loadKg?: number | null; reps?: number | null; timeSec?: number | null }[];
      };
    });

/**
 * As métricas desnormalizadas de uma atividade.
 *
 * Deixou de ser `Record<string, number>` quando o CrossFit passou a promover
 * para cá o que precisa ser consultável: quais blocos, quais movimentos, e o
 * resumo do WOD. Declarar o que existe é melhor que espalhar cast por tela.
 */
export interface ActivityMetrics {
  minutes?: number;
  volumeTotalKg?: number;
  seriesValidas?: number;
  distanceKm?: number;
  avgPaceSecPerKm?: number;
  speedKmh?: number;
  elevationGainM?: number;
  /** CrossFit: os tipos de bloco, na ordem em que aconteceram. */
  blocos?: string[];
  /** CrossFit: movimentos normalizados — alimenta "mais executados". */
  movimentos?: string[];
  wod?: {
    slug: string | null;
    familia: string | null;
    formato: string;
    escala: string;
    scoreTipo: string | null;
    scoreValor: number | null;
    maiorMelhor: boolean | null;
    capado: boolean;
  };
}

export interface Activity {
  id: string;
  sportId: string;
  kind: string;
  title: string;
  startedAt: string;
  durationSec: number;
  visibility: "private" | "followers" | "public";
  notes: string;
  metrics: ActivityMetrics;
  payload?: unknown;
  /** Treino de CrossFit já em blocos. O servidor normaliza os dois formatos. */
  crossfit?: PayloadDeCrossfit | null;
  perceivedEffort?: number | null;
  feeling?: string | null;
  // Presente ao buscar por id (ex.: abrir treino de outra pessoa pelo feed).
  owner?: { id: string; name: string; username: string | null; avatarUrl: string } | null;
  // Post do compartilhamento — para curtir/comentar direto do detalhe.
  post?: { id: string; likeCount: number; commentCount: number; likedByMe: boolean } | null;
}

export async function getActivity(token: string, id: string): Promise<Activity> {
  const res = await apiFetch<{ data: Activity }>(`/activities/${id}`, { token });
  return res.data;
}

// Última atividade do usuário num esporte (para pré-preencher o próximo registro).
export async function getLastActivity(token: string, sportId: string, kind?: string): Promise<Activity | null> {
  const q = new URLSearchParams({ sportId, ...(kind ? { kind } : {}) }).toString();
  const res = await apiFetch<{ data: Activity | null }>(`/activities/last?${q}`, { token });
  return res.data;
}

export interface NewPR {
  type: "carga_max" | "rm_estimado" | "carga_faixa" | "best_dist" | "best_time" | "aulas" | "horas";
  exerciseName: string;
  repRange: string | null;
  value: number;
  previousValue: number | null;
  unit: string;
  milestone?: number;
}

export async function createActivity(
  token: string,
  input: CreateActivityInput
): Promise<{ data: Activity; meta: { sharedPostId: string | null; newPRs: NewPR[] } }> {
  return apiFetch("/activities", { method: "POST", body: input, token });
}

export async function listActivities(
  token: string,
  cursor?: string
): Promise<{ data: Activity[]; meta: { nextCursor: string | null } }> {
  const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiFetch(`/activities${q}`, { token });
}
