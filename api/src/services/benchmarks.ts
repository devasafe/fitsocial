import type { Movimento } from "../models/crossfit.js";

/**
 * Catálogo de WODs conhecidos.
 *
 * Estático, como `sports.ts`: não muda por usuário, não precisa de migração e
 * não vale uma coleção no banco. Serve a três coisas:
 *
 * 1. **Identidade para o recorde.** "Fran", "fran" e "FRAN " são o mesmo treino;
 *    sem uma chave estável virariam três recordes que nunca se comparam. E o
 *    contrário também importa: "WOD do dia" NÃO está aqui, então não vira
 *    recorde — comparar treinos diferentes que dividem um nome genérico seria
 *    inventar uma evolução que não existe.
 * 2. **Preenchimento automático.** Escolher Fran já traz 21-15-9 Thruster/Pull-up.
 * 3. **Autocomplete** na hora de registrar.
 *
 * A lista é curta de propósito: entram os que as pessoas de fato repetem e
 * comparam. Um WOD fora daqui continua registrável — só não vira benchmark.
 */

export const FAMILIAS = ["girl", "hero", "open", "outro"] as const;
export type FamiliaDeBenchmark = (typeof FAMILIAS)[number];

export interface Benchmark {
  slug: string;
  nome: string;
  familia: FamiliaDeBenchmark;
  formato: "for_time" | "amrap" | "rft" | "emom" | "max_load" | "outro";
  rounds?: number;
  duracaoSec?: number;
  timeCapSec?: number;
  movimentos: Movimento[];
  /** O que costuma valer como RX, para a tela sugerir. */
  notaRx?: string;
}

// Construtores do catalogo. Sem eles cada entrada repetiria `escopo:
// "individual"` e o `unidade` do volume - ruido que esconde o dado.
const kg = (rx: number, rxF?: number): Movimento["carga"] => ({
  rx,
  rxF: rxF ?? null,
  unidade: "kg",
  rxKg: rx,
  rxFKg: rxF ?? null,
});

const reps = (valor: number | number[]): Movimento["volume"] => ({ valor, unidade: "reps" });
const metros = (valor: number): Movimento["volume"] => ({ valor, unidade: "metros" });
const cal = (valor: number): Movimento["volume"] => ({ valor, unidade: "cal" });
const seg = (valor: number): Movimento["volume"] => ({ valor, unidade: "seg" });

/** Benchmark e prescricao individual: o escopo de time nao se aplica. */
function mov(
  nome: string,
  volume?: Movimento["volume"],
  carga?: Movimento["carga"],
  notas?: string
): Movimento {
  return {
    nome,
    volume: volume ?? null,
    carga: carga ?? null,
    escopo: "individual",
    series: null,
    altura: null,
    notas: notas ?? null,
  };
}

export const BENCHMARKS: readonly Benchmark[] = [
  {
    slug: "fran",
    nome: "Fran",
    familia: "girl",
    formato: "for_time",
    movimentos: [
      mov("Thruster", reps([21, 15, 9]), kg(43)),
      mov("Pull Up", reps([21, 15, 9])),
    ],
    notaRx: "43 kg / 30 kg · pull-up",
  },
  {
    slug: "grace",
    nome: "Grace",
    familia: "girl",
    formato: "for_time",
    movimentos: [mov("Clean & Jerk", reps(30), kg(61))],
    notaRx: "61 kg / 43 kg",
  },
  {
    slug: "isabel",
    nome: "Isabel",
    familia: "girl",
    formato: "for_time",
    movimentos: [mov("Snatch", reps(30), kg(61))],
    notaRx: "61 kg / 43 kg",
  },
  {
    slug: "helen",
    nome: "Helen",
    familia: "girl",
    formato: "rft",
    rounds: 3,
    movimentos: [
      mov("Run", metros(400)),
      mov("Kettlebell Swing", reps(21), kg(24)),
      mov("Pull Up", reps(12)),
    ],
    notaRx: "24 kg / 16 kg",
  },
  {
    slug: "cindy",
    nome: "Cindy",
    familia: "girl",
    formato: "amrap",
    duracaoSec: 20 * 60,
    movimentos: [
      mov("Pull Up", reps(5)),
      mov("Push Up", reps(10)),
      mov("Air Squat", reps(15)),
    ],
  },
  {
    slug: "annie",
    nome: "Annie",
    familia: "girl",
    formato: "for_time",
    movimentos: [
      mov("Double Under", reps([50, 40, 30, 20, 10])),
      mov("Sit Up", reps([50, 40, 30, 20, 10])),
    ],
  },
  {
    slug: "diane",
    nome: "Diane",
    familia: "girl",
    formato: "for_time",
    movimentos: [
      mov("Deadlift", reps([21, 15, 9]), kg(102)),
      mov("Handstand Push Up", reps([21, 15, 9])),
    ],
    notaRx: "102 kg / 70 kg",
  },
  {
    slug: "karen",
    nome: "Karen",
    familia: "girl",
    formato: "for_time",
    movimentos: [mov("Wall Ball", reps(150), kg(9))],
    notaRx: "9 kg / 6 kg",
  },
  {
    slug: "elizabeth",
    nome: "Elizabeth",
    familia: "girl",
    formato: "for_time",
    movimentos: [
      mov("Clean", reps([21, 15, 9]), kg(61)),
      mov("Ring Dip", reps([21, 15, 9])),
    ],
  },
  {
    slug: "murph",
    nome: "Murph",
    familia: "hero",
    formato: "for_time",
    movimentos: [
      mov("Run", metros(1609)),
      mov("Pull Up", reps(100)),
      mov("Push Up", reps(200)),
      mov("Air Squat", reps(300)),
      mov("Run", metros(1609)),
    ],
    notaRx: "com colete de 9 kg / 6 kg",
  },
  {
    slug: "dt",
    nome: "DT",
    familia: "hero",
    formato: "rft",
    rounds: 5,
    movimentos: [
      mov("Deadlift", reps(12), kg(70)),
      mov("Hang Power Clean", reps(9), kg(70)),
      mov("Push Jerk", reps(6), kg(70)),
    ],
    notaRx: "70 kg / 47 kg",
  },
  {
    slug: "jt",
    nome: "JT",
    familia: "hero",
    formato: "for_time",
    movimentos: [
      mov("Handstand Push Up", reps([21, 15, 9])),
      mov("Ring Dip", reps([21, 15, 9])),
      mov("Push Up", reps([21, 15, 9])),
    ],
  },
  {
    slug: "fight_gone_bad",
    nome: "Fight Gone Bad",
    familia: "outro",
    formato: "amrap",
    rounds: 3,
    duracaoSec: 17 * 60,
    movimentos: [
      mov("Wall Ball", undefined, kg(9)),
      mov("Sumo Deadlift High Pull", undefined, kg(35)),
      mov("Box Jump"),
      mov("Push Press", undefined, kg(35)),
      mov("Row"),
    ],
  },
];

const POR_SLUG = new Map(BENCHMARKS.map((b) => [b.slug, b]));

/** Normalização usada para casar nome digitado com benchmark conhecido. */
function normalizar(nome: string): string {
  return nome
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const POR_NOME = new Map(BENCHMARKS.map((b) => [normalizar(b.nome), b]));

export function getBenchmark(slug: string): Benchmark | undefined {
  return POR_SLUG.get(slug);
}

/**
 * Descobre o benchmark a partir do nome digitado.
 *
 * Devolve `undefined` para nome livre — e isso é o comportamento desejado:
 * "WOD do dia" não deve virar um recorde que compara treinos sem relação.
 */
export function resolverBenchmark(nome?: string | null): Benchmark | undefined {
  if (!nome) return undefined;
  return POR_NOME.get(normalizar(nome));
}

/** Sugestões para o autocomplete, filtradas pelo que já foi digitado. */
export function buscarBenchmarks(termo: string, limite = 8): Benchmark[] {
  const t = normalizar(termo);
  if (!t) return BENCHMARKS.slice(0, limite);
  return BENCHMARKS.filter((b) => normalizar(b.nome).includes(t)).slice(0, limite);
}
