import { apiFetch } from "./client";

// Espelho do modelo do servidor (api/src/models/crossfit.ts).
//
// Um treino é uma lista de blocos, na ordem em que aconteceram. Cada bloco tem
// um MODO — a linha que o coach escreveu no quadro — e uma lista de movimentos.
// Não existe "tipo de treino": o que diferencia aquecimento de WOD é o que está
// escrito no modo, e quem deduz o resto é o servidor.

export type UnidadeDeCarga = "kg" | "lb" | "percent_1rm" | "corporal" | "livre";

export interface Carga {
  /** A prescrição principal. No quadro misto "43/30", é o 43. */
  rx?: number | null;
  /** A segunda prescrição do quadro. No "43/30", é o 30. */
  rxF?: number | null;
  unidade: UnidadeDeCarga;
  /** Para o que não é número: "caixa de 20 in", "colete de 10 kg". */
  texto?: string | null;
  /** Derivados no servidor. Só leitura. */
  rxKg?: number | null;
  rxFKg?: number | null;
}

export const UNIDADES_DE_VOLUME = ["reps", "seg", "metros", "cal"] as const;
export type UnidadeDeVolume = (typeof UNIDADES_DE_VOLUME)[number];

export interface Volume {
  /** 21, ou [21, 15, 9] quando a escada muda a cada round. */
  valor: number | number[];
  unidade: UnidadeDeVolume;
}

/**
 * Em dupla ou equipe, o volume escrito no quadro não é o que cada um faz.
 * Sem isto a conta sai errada em qualquer treino de time.
 */
export const ESCOPOS = ["individual", "dividido", "cada", "junto"] as const;
export type Escopo = (typeof ESCOPOS)[number];

export const ROTULO_DO_ESCOPO: Record<Escopo, string> = {
  individual: "Cada um faz tudo",
  dividido: "Dividido entre o time",
  cada: "Cada um faz essa conta",
  junto: "Juntos, conta uma vez",
};

export interface Movimento {
  /** SÓ o nome. O número vive no volume — junto, apodrece o autocomplete. */
  nome: string;
  volume?: Volume | null;
  /** O "3" de "3×10". */
  series?: number | null;
  carga?: Carga | null;
  altura?: { valor: number; unidade: "cm" | "in" } | null;
  escopo: Escopo;
  notas?: string | null;
}

export type NivelDeEscala = "rx" | "rx_plus" | "scaled" | "iniciante" | "custom" | "adaptado";

export interface Escala {
  nivel: NivelDeEscala;
  ajustes?: { de: string; para: string }[] | null;
  notas?: string | null;
}

export type TipoDeScore =
  | "tempo"
  | "rounds_reps"
  | "reps"
  | "carga"
  | "distancia"
  | "customizado";

export interface Score {
  tipo: TipoDeScore;
  tempoSec?: number | null;
  rounds?: number | null;
  repsExtras?: number | null;
  reps?: number | null;
  cargaKg?: number | null;
  distanciaM?: number | null;
  /** Só para "customizado": o que esse número quer dizer. */
  descricao?: string | null;
  /** Estourou o time cap: o resultado é o parcial, não um tempo. */
  capado?: boolean | null;
}

export const FAMILIAS_DE_MODO = [
  "amrap",
  "for_time",
  "rft",
  "emom",
  "tabata",
  "intervalo",
  "max_reps",
  "max_load",
  "descanso",
  "livre",
] as const;
export type FamiliaDeModo = (typeof FAMILIAS_DE_MODO)[number];

/**
 * O que o servidor entendeu do modo. DERIVADO — nunca se envia isto.
 *
 * Existe para a tela mostrar o timer certo e sugerir o tipo de score sem que
 * ninguém precise escolher categoria.
 */
export interface Leitura {
  familia?: FamiliaDeModo | null;
  duracaoSec?: number | null;
  timeCapSec?: number | null;
  intervaloSec?: number | null;
  rounds?: number | null;
  scoreSugerido?: TipoDeScore | "nenhum" | null;
  versao: number;
}

export interface Bloco {
  /** O que o coach escreveu: "AMRAP 6'", "EMOM (1'15\") x 4", "REST 1'". */
  modo: string;
  /** "BLOCO A", "Fran", "Relay". */
  nome?: string | null;
  benchmark?: { slug: string; familia: "girl" | "hero" | "open" | "outro" } | null;
  movimentos: Movimento[];
  /** Preenchido pelo servidor no salvamento. */
  lido?: Leitura | null;
  resultado?: Score | null;
  escala: Escala;
  rounds?: { numero: number; tempoSec?: number | null; reps?: number | null }[] | null;
  notas?: string | null;
}

export interface PayloadDeCrossfit {
  v: 3;
  nome?: string | null;
  box?: string | null;
  /**
   * O quadro, do jeito que a pessoa colou.
   *
   * Guardado sempre: os blocos são a interpretação, este texto é a fonte. Se a
   * leitura errar, o treino continua registrável e daqui a um ano ainda dá
   * para saber o que o coach escreveu.
   */
  quadro?: string | null;
  /** 1 = sozinho. Acima disso, o escopo de cada movimento passa a importar. */
  tamanhoDoTime: number;
  parceiros?: string[] | null;
  blocos: Bloco[];
}

/** Um bloco novo, vazio. O escopo e a escala já vêm com o padrão de sempre. */
export function blocoVazio(modo = ""): Bloco {
  return { modo, nome: null, movimentos: [], escala: { nivel: "rx" }, resultado: null };
}

export function movimentoVazio(nome = ""): Movimento {
  return { nome, volume: null, carga: null, escopo: "individual" };
}

export interface LeituraDoQuadro {
  box?: string | null;
  tamanhoDoTime: number;
  blocos: Bloco[];
  /** O que a leitura não conseguiu interpretar. Vazio quando leu tudo. */
  observacao: string;
}

/**
 * Manda o quadro da aula e recebe os blocos montados. NÃO grava nada.
 *
 * A leitura preenche o que estava NO QUADRO e nunca o resultado: quanto você
 * fez não está escrito lá, e um resultado inventado viraria recorde falso.
 */
export async function lerQuadro(token: string, texto: string): Promise<LeituraDoQuadro> {
  const r = await apiFetch<{ data: LeituraDoQuadro }>("/activities/ler-quadro", {
    method: "POST",
    token,
    body: { texto },
  });
  return r.data;
}

// ---- Benchmarks ----

export interface Benchmark {
  slug: string;
  nome: string;
  familia: "girl" | "hero" | "open" | "outro";
  formato: string;
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
