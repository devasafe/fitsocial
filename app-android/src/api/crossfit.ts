import { apiFetch } from "./client";

// Espelho do modelo do servidor (api/src/models/crossfit.ts). Um treino é uma
// lista de blocos, na ordem em que aconteceram — nenhum obrigatório.

export type UnidadeDeCarga = "kg" | "lb" | "percent_1rm" | "corporal" | "livre";

export interface Carga {
  valor?: number | null;
  unidade: UnidadeDeCarga;
  texto?: string | null;
}

export interface Movimento {
  nome: string;
  /** Repetições fixas por round. */
  reps?: number | null;
  /** Repetições que mudam a cada round: [21, 15, 9]. */
  repScheme?: number[] | null;
  distanciaM?: number | null;
  calorias?: number | null;
  duracaoSec?: number | null;
  /** A carga que VOCÊ usou. O quadro quase nunca prescreve peso. */
  carga?: Carga | null;
  /** "2 Rope Climb (cada)": em dupla, cada um faz a conta inteira. */
  porPessoa?: boolean | null;
  notas?: string | null;
}

/** Metade do quadro de um box é em dupla, e o esforço não é o mesmo. */
export type ModoDeEquipe = "revezamento" | "junto" | "dividido";

export interface Equipe {
  tamanho: number;
  modo: ModoDeEquipe;
  /** Texto livre: nem todo parceiro tem conta no app. */
  parceiros?: string[] | null;
}

export type NivelDeEscala = "rx" | "rx_plus" | "scaled" | "iniciante" | "custom";

export interface Escala {
  nivel: NivelDeEscala;
  ajustes?: { de: string; para: string }[] | null;
  notas?: string | null;
}

export type TipoDeScore = "tempo" | "rounds_reps" | "reps" | "carga" | "distancia";

export interface Score {
  tipo: TipoDeScore;
  tempoSec?: number | null;
  rounds?: number | null;
  repsExtras?: number | null;
  reps?: number | null;
  cargaKg?: number | null;
  distanciaM?: number | null;
  /** Estourou o time cap: o resultado é o parcial, não um tempo. */
  capado?: boolean | null;
}

export type FormatoDeMetcon =
  | "for_time"
  | "amrap"
  | "emom"
  | "rft"
  | "tabata"
  | "intervalo"
  | "max_reps"
  | "max_load"
  | "outro";

export interface SerieDeForca {
  type?: "aquecimento" | "valida" | "drop" | "falha" | "rest_pause" | "backoff";
  weightKg: number;
  reps?: number | null;
  done?: boolean;
}

export interface ExercicioDeForca {
  name: string;
  sets: SerieDeForca[];
}

export type TipoDeBloco =
  | "aquecimento"
  | "mobilidade"
  | "skill"
  | "forca"
  | "metcon"
  | "descanso"
  | "cooldown";

export type FormatoLivre = "emom" | "circuito" | "livre";

export interface BlocoLivre {
  tipo: "aquecimento" | "mobilidade" | "cooldown";
  /** Aquecimento tem estrutura: "EMOM 1'15\" × 4" é o formato mais comum. */
  formato?: FormatoLivre | null;
  intervaloSec?: number | null;
  duracaoSec?: number | null;
  rounds?: number | null;
  movimentos: Movimento[];
  notas?: string | null;
}

/** O REST entre as partes do WOD. */
export interface BlocoDescanso {
  tipo: "descanso";
  duracaoSec?: number | null;
  notas?: string | null;
}

export interface BlocoSkill {
  tipo: "skill";
  movimento: string;
  formato?: "emom" | "pratica_livre" | "series" | null;
  duracaoSec?: number | null;
  intervaloSec?: number | null;
  series?: number | null;
  repsPorSerie?: number | null;
  tentativas?: number | null;
  acertos?: number | null;
  /** "35 unbroken" — é o que vira recorde de skill. */
  melhorSequencia?: number | null;
  carga?: Carga | null;
  notas?: string | null;
}

export interface BlocoForca {
  tipo: "forca";
  exercicios: ExercicioDeForca[];
  notas?: string | null;
}

export interface BlocoMetcon {
  tipo: "metcon";
  nome?: string | null;
  benchmark?: { slug: string; familia: "girl" | "hero" | "open" | "outro" } | null;
  formato: FormatoDeMetcon;
  formatoLivre?: string | null;
  /** O que estava no quadro — separado do que aconteceu. */
  prescricao: {
    rounds?: number | null;
    duracaoSec?: number | null;
    timeCapSec?: number | null;
    intervaloSec?: number | null;
    trabalhoSec?: number | null;
    descansoSec?: number | null;
    movimentos: Movimento[];
  };
  resultado?: Score | null;
  escala: Escala;
  /** Preenchido quando foi em dupla ou equipe. Ausente = individual. */
  equipe?: Equipe | null;
  /** Junta partes do MESMO WOD: Bloco A, Bloco B e o final. */
  grupo?: string | null;
  rounds?: { numero: number; tempoSec?: number | null; reps?: number | null }[] | null;
  notas?: string | null;
}

export type Bloco = BlocoLivre | BlocoDescanso | BlocoSkill | BlocoForca | BlocoMetcon;

export interface PayloadDeCrossfit {
  v: 2;
  box?: string | null;
  blocos: Bloco[];
}

// ---- Benchmarks ----

export interface Benchmark {
  slug: string;
  nome: string;
  familia: "girl" | "hero" | "open" | "outro";
  formato: FormatoDeMetcon;
  rounds?: number;
  duracaoSec?: number;
  timeCapSec?: number;
  movimentos: Movimento[];
  notaRx?: string;
}

/** Catálogo de WODs conhecidos — alimenta o autocomplete e o preenchimento. */
export function buscarBenchmarks(token: string, q = "") {
  return apiFetch<{ data: Benchmark[] }>(
    `/sports/benchmarks${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    { token }
  );
}

/** Um benchmark que a pessoa já fez, com a evolução. */
export interface BenchmarkFeito {
  slug: string;
  nome: string;
  familia: string | null;
  escala: string;
  formato: string;
  scoreTipo: string | null;
  maiorMelhor: boolean;
  vezes: number;
  melhor: { valor: number; quando: string } | null;
  ultimo: { valor: number; quando: string } | null;
  /** Positivo é melhora, em qualquer tipo de score. Nulo se só fez uma vez. */
  delta: number | null;
}

export function listarBenchmarks(token: string) {
  return apiFetch<{ data: BenchmarkFeito[] }>("/activities/benchmarks", { token });
}
