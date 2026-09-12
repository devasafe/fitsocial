import { apiFetch } from "./client";
import type { MuscleGroup } from "./library";

// A aba Progresso. O servidor agrega; o app desenha.

/** Janelas oferecidas na tela. Zero é "tudo". */
export const JANELAS = [30, 90, 365, 0] as const;
export type Janela = (typeof JANELAS)[number];

export function rotuloDaJanela(dias: Janela): string {
  if (dias === 0) return "Tudo";
  if (dias === 365) return "1 ano";
  return `${dias} dias`;
}

export const METRICAS = ["carga_max", "rm_estimado", "volume", "series", "reps"] as const;
export type Metrica = (typeof METRICAS)[number];

export function rotuloDaMetrica(m: Metrica): string {
  switch (m) {
    case "carga_max":
      return "Carga";
    case "rm_estimado":
      return "1RM est.";
    case "volume":
      return "Volume";
    case "series":
      return "Séries";
    case "reps":
      return "Repetições";
  }
}

/** Unidade do eixo, para o rótulo do gráfico não mentir a métrica. */
export function unidadeDaMetrica(m: Metrica): string {
  switch (m) {
    case "carga_max":
    case "rm_estimado":
      return "kg";
    case "volume":
      return "kg";
    case "series":
      return "séries";
    case "reps":
      return "reps";
  }
}

export interface ExercicioNaLista {
  slug: string;
  nome: string;
  vezes: number;
  melhor: number;
  ultimo: number;
  /** Positivo é melhora. Nulo quando só treinou uma vez. */
  delta: number | null;
  ultimaVez: string;
}

export interface PontoDoExercicio {
  data: string;
  valor: number;
  /** Neste treino a pessoa bateu o próprio recorde. */
  ehPR: boolean;
}

export interface GrupoTreinado {
  grupo: MuscleGroup;
  series: number;
}

export interface DiaDoCalendario {
  dia: string;
  treinos: number;
  minutos: number;
}

export async function listarExercicios(token: string, dias: Janela): Promise<ExercicioNaLista[]> {
  const r = await apiFetch<{ data: ExercicioNaLista[] }>(`/evolucao/exercicios?dias=${dias}`, { token });
  return r.data;
}

export async function serieDoExercicio(
  token: string,
  slug: string,
  dias: Janela,
  metrica: Metrica
): Promise<PontoDoExercicio[]> {
  const r = await apiFetch<{ data: PontoDoExercicio[] }>(
    `/evolucao/exercicios/${encodeURIComponent(slug)}?dias=${dias}&metrica=${metrica}`,
    { token }
  );
  return r.data;
}

export async function listarGrupos(token: string, dias: Janela): Promise<GrupoTreinado[]> {
  const r = await apiFetch<{ data: GrupoTreinado[] }>(`/evolucao/grupos?dias=${dias}`, { token });
  return r.data;
}

export async function calendario(token: string, dias = 365): Promise<DiaDoCalendario[]> {
  const r = await apiFetch<{ data: DiaDoCalendario[] }>(`/evolucao/calendario?dias=${dias}`, { token });
  return r.data;
}

// ------------------------------------------------------------------- cardio

/** O que dá para plotar de um esporte de cardio. */
export const METRICAS_CARDIO = ["pace", "distancia", "duracao", "velocidade"] as const;
export type MetricaCardio = (typeof METRICAS_CARDIO)[number];

export function rotuloDaMetricaCardio(m: MetricaCardio): string {
  switch (m) {
    case "pace":
      return "Pace";
    case "distancia":
      return "Distância";
    case "duracao":
      return "Duração";
    case "velocidade":
      return "Velocidade";
  }
}

/** Pace vem em segundos por quilômetro e se lê em minutos: 300 é "5:00/km". */
export function formatarCardio(v: number, m: MetricaCardio): string {
  switch (m) {
    case "pace": {
      const min = Math.floor(v / 60);
      const seg = Math.round(v % 60);
      // 59,6 s arredonda para 60: vira o minuto seguinte, não "5:60".
      return seg === 60 ? `${min + 1}:00` : `${min}:${String(seg).padStart(2, "0")}`;
    }
    case "distancia":
      return `${v.toFixed(1).replace(".", ",")} km`;
    case "duracao":
      return `${Math.round(v)} min`;
    case "velocidade":
      return `${v.toFixed(1).replace(".", ",")} km/h`;
  }
}

export interface EsporteNaLista {
  sportId: string;
  nome: string;
  vezes: number;
  distanciaKm: number;
  /** Segundos por quilômetro. Zero quando nenhuma sessão teve distância. */
  melhorPace: number;
  ultimoPace: number;
  /** Positivo é melhora: o pace CAIU. Nulo quando só houve uma sessão. */
  delta: number | null;
  ultimaVez: string;
}

export async function listarCardio(token: string, dias: Janela): Promise<EsporteNaLista[]> {
  const r = await apiFetch<{ data: EsporteNaLista[] }>(`/evolucao/cardio?dias=${dias}`, { token });
  return r.data;
}

export async function serieDeCardio(
  token: string,
  sportId: string,
  dias: Janela,
  metrica: MetricaCardio
): Promise<{ pontos: PontoDoExercicio[]; menorEhMelhor: boolean }> {
  const r = await apiFetch<{
    data: PontoDoExercicio[];
    meta: { menorEhMelhor: boolean };
  }>(`/evolucao/cardio/${encodeURIComponent(sportId)}?dias=${dias}&metrica=${metrica}`, { token });
  return { pontos: r.data, menorEhMelhor: r.meta.menorEhMelhor };
}

export interface Conquista {
  id: string;
  sportId: string;
  exerciseName: string;
  exerciseSlug: string;
  type: string;
  repRange: string | null;
  value: number;
  previousValue: number;
  unit: string;
  achievedAt: string;
}

export async function listarConquistas(
  token: string,
  opts: { cursor?: string | null; slug?: string; limit?: number } = {}
): Promise<{ itens: Conquista[]; nextCursor: string | null }> {
  const q = new URLSearchParams();
  if (opts.cursor) q.set("cursor", opts.cursor);
  if (opts.slug) q.set("slug", opts.slug);
  q.set("limit", String(opts.limit ?? 30));

  const r = await apiFetch<{ data: Conquista[]; meta: { nextCursor: string | null } }>(
    `/prs/historico?${q.toString()}`,
    { token }
  );
  return { itens: r.data, nextCursor: r.meta.nextCursor };
}
