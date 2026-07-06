export type ExerciseKind = "strength" | "cardio";

// Palavras-chave (no nome normalizado) que indicam cardio.
const CARDIO_KEYWORDS = [
  "esteira", "corrida", "correr", "caminhada", "caminhar", "bike", "bicicleta",
  "ciclismo", "spinning", "eliptico", "transport", "remo", "remador", "escada",
  "stair", "pular corda", "corda", "hiit", "cardio", "natacao", "nadar", "aerobico",
];

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Classifica um exercício como cardio ou musculação a partir do nome e do
 * formato do "reps". Usado como fallback quando a IA não marcou o tipo.
 */
export function classifyExerciseKind(name: string, reps?: string): ExerciseKind {
  const n = normalize(name);
  if (CARDIO_KEYWORDS.some((k) => n.includes(k))) return "cardio";

  if (reps) {
    const r = normalize(reps);
    // tempo (min, "20:00", "30s") ou distância (km, "800 m")
    if (/\bmin\b|\bkm\b|\bm\b|\d\s*:\s*\d|\d\s*s\b/.test(r)) return "cardio";
  }
  return "strength";
}

/**
 * Preenche `kind` de cada exercício do treino APENAS quando ausente
 * (confia no valor que a IA mandar). Mutação in-place + retorno.
 */
export function backfillWorkoutKinds<
  W extends { sessions: { exercises: { name: string; reps: string; kind?: ExerciseKind }[] }[] }
>(workout: W): W {
  for (const session of workout.sessions) {
    for (const ex of session.exercises) {
      if (!ex.kind) ex.kind = classifyExerciseKind(ex.name, ex.reps);
    }
  }
  return workout;
}
