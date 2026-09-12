// De um nome de exercício para o grupo muscular que ele treina.
//
// O dado já existia no catálogo (`exercisesCatalog.ts`), mas só servia de
// legenda no autocomplete: o que chega gravado no treino é texto livre. Então a
// resolução precisa funcionar nos dois mundos — no exercício escolhido da lista
// e no que a pessoa digitou do jeito dela.
//
// Determinístico de propósito. É dicionário, não julgamento: roda no save de
// todo treino e no feed de todo mundo, e a mesma entrada tem que dar sempre a
// mesma saída. Mesma forma do `exerciseKind.ts`, que resolve cardio vs força.

import { EXERCISES } from "./exercisesCatalog.js";

/**
 * ATENÇÃO: estes valores são GRAVADOS, não são só rótulo de tela.
 *
 * Cada string aqui é, ao mesmo tempo, o texto do card, o conteúdo de
 * `metrics.musculos` e a CHAVE de `metrics.seriesPorGrupo` no Mongo. Renomear
 * "Abdômen" para "Core" órfã todo dado já gravado e quebra a consulta do alerta
 * de desequilíbrio do coach. Acrescentar grupo é seguro; renomear exige aceitar
 * os dois nomes e migrar, como qualquer id estável do projeto.
 */
export const MUSCLE_GROUPS = [
  "Peito",
  "Costas",
  "Quadríceps",
  "Posterior de coxa",
  "Glúteo",
  "Panturrilha",
  "Ombro",
  "Trapézio",
  "Bíceps",
  "Tríceps",
  "Abdômen",
  "Corpo todo",
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

const GRUPOS = new Set<string>(MUSCLE_GROUPS);

export function isMuscleGroup(v: unknown): v is MuscleGroup {
  return typeof v === "string" && GRUPOS.has(v);
}

/** Remove acento e caixa — a mesma normalização do resto do projeto. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Índices do catálogo, montados uma vez. O catálogo é constante em memória.
const PELO_ID = new Map<string, MuscleGroup>();
const PELO_NOME = new Map<string, MuscleGroup>();

for (const ex of EXERCISES) {
  PELO_ID.set(ex.id, ex.muscle);
  PELO_NOME.set(normalize(ex.name), ex.muscle);
  if (ex.nameEn) PELO_NOME.set(normalize(ex.nameEn), ex.muscle);
}

/**
 * Termos compostos que uma palavra curta de OUTRO grupo rouba.
 *
 * Conferidos antes da lista por grupo. Sem isto, "coice" (glúteo) casa primeiro
 * e "tríceps coice" — exercício banal de academia — era anunciado como GLÚTEO
 * no card público de quem treinou. O mesmo com "remada alta", que virava
 * costas, e "crucifixo inverso", que virava peito.
 *
 * Só entram aqui termos de duas palavras ou mais cuja primeira palavra pertence
 * a outro grupo. O invariante em `muscleGroups.test.ts` falha se algum termo de
 * `PALAVRAS` voltar a ser roubado assim.
 */
const ESPECIFICOS: [MuscleGroup, string[]][] = [
  ["Trapézio", ["remada alta"]],
  ["Ombro", [
    "crucifixo inverso", "crucifixo invertido",
    "voador inverso", "voador invertido",
    "peck deck inverso", "peck deck invertido",
    "elevacao posterior",
  ]],
  ["Tríceps", ["coice de triceps", "triceps coice", "rosca francesa"]],
  ["Abdômen", ["flexao abdominal", "flexao lateral"]],
  ["Posterior de coxa", ["flexao de perna", "flexao de joelho"]],
];

// Palavras-chave para o que foi digitado à mão. "supino inclinado com halter na
// máquina smith" não casa com nenhum nome do catálogo, mas tem "supino" dentro.
//
// A ordem importa: a primeira entrada que casar vence. Por isso o que é
// específico vem antes do que é genérico — "panturrilha no leg press" é
// panturrilha, não quadríceps. O que uma palavra curta de outro grupo roubaria
// não mora aqui: mora em ESPECIFICOS, acima.
export const PALAVRAS: [MuscleGroup, string[]][] = [
  ["Panturrilha", ["panturrilha", "gemeos", "soleo", "calf"]],
  ["Posterior de coxa", ["stiff", "flexora", "posterior de coxa", "isquio", "romeno", "leg curl", "hamstring", "good morning"]],
  ["Glúteo", ["gluteo", "pelvica", "hip thrust", "abdutora", "coice", "gluteo maquina"]],
  ["Quadríceps", ["agacha", "squat", "leg press", "extensora", "afundo", "avanco", "passada", "bulgaro", "hack", "leg extension", "sissy"]],
  ["Peito", ["supino", "crucifixo", "crossover", "peitoral", "peito", "flexao de braco", "flexao", "push-up", "push up", "bench press", "chest", "voador", "peck deck"]],
  ["Costas", ["remada", "puxada", "pulldown", "pullover", "barra fixa", "pull-up", "pull up", "dorsal", "costas", "serrote", "graviton", "row", "lat ", "muscle-up", "muscle up", "front lever"]],
  ["Bíceps", ["rosca", "biceps", "curl", "scott", "concentrada"]],
  ["Tríceps", ["triceps", "testa", "frances", "mergulho", "paralelas", "pushdown", "dips", "skull"]],
  ["Trapézio", ["encolhimento", "trapezio", "shrug"]],
  ["Ombro", ["desenvolvimento", "elevacao lateral", "elevacao frontal", "ombro", "deltoide", "arnold", "overhead press", "military", "face pull", "parada de mao", "handstand", "hspu"]],
  ["Abdômen", ["abdominal", "abdomen", "prancha", "plank", "core", "obliquo", "elevacao de pernas", "l-sit", "l sit", "sit-up", "sit up", "crunch"]],
  ["Corpo todo", ["clean", "snatch", "jerk", "thruster", "arranco", "arremesso", "burpee", "levantamento terra", "deadlift", "terra", "farmer", "swing", "kettlebell"]],
];

export interface ExercicioResolvivel {
  /** Marcado pela pessoa ou herdado do catálogo no momento da escolha. */
  muscle?: string | null;
  /** Id do catálogo, quando o exercício veio do autocomplete. */
  exerciseId?: string | null;
  name: string;
}

/**
 * O grupo muscular de um exercício, em ordem de confiança:
 * o que gente marcou > o id do catálogo > o nome exato > palavra-chave no nome.
 *
 * `null` quando nada casa — e aí o exercício só não entra na conta. Chutar um
 * grupo errado é pior do que não mostrar: quem treinou sabe o que treinou.
 */
export function resolveMuscle(ex: ExercicioResolvivel): MuscleGroup | null {
  if (isMuscleGroup(ex.muscle)) return ex.muscle;

  if (ex.exerciseId) {
    const doCatalogo = PELO_ID.get(ex.exerciseId);
    if (doCatalogo) return doCatalogo;
  }

  return muscleOf(ex.name);
}

/** Só pelo nome — para quem tem a string e mais nada. */
export function muscleOf(name: string): MuscleGroup | null {
  const n = normalize(name ?? "");
  if (!n) return null;

  const exato = PELO_NOME.get(n);
  if (exato) return exato;

  for (const [grupo, termos] of ESPECIFICOS) {
    if (termos.some((t) => n.includes(t))) return grupo;
  }

  for (const [grupo, palavras] of PALAVRAS) {
    if (palavras.some((p) => n.includes(p))) return grupo;
  }

  return null;
}

