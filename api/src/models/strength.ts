import { z } from "zod";
import { MUSCLE_GROUPS } from "../services/muscleGroups.js";

// Séries e exercícios de força — extraídos de Activity.ts porque o CrossFit
// reusa este schema tal e qual, e importar de Activity criaria um ciclo
// (Activity precisa dos blocos de CrossFit, que precisam disto).

// ---- Payload strength (Fase 2a) ----
// Nível "caminho rápido" do docs/ESPORTES.md §4. Campos ricos (rpe, rir, tempo,
// superset, assistida) entram junto do motor de PR em fatias posteriores.

export const STRENGTH_SET_TYPES = [
  "aquecimento",
  "valida",
  "drop",
  "falha",
  "rest_pause",
  "backoff",
] as const;

export const strengthSetSchema = z.object({
  order: z.number().int().min(0).optional(),
  type: z.enum(STRENGTH_SET_TYPES).default("valida"),
  weightKg: z.number().min(0).max(1000).default(0),
  reps: z.number().int().min(0).max(1000).nullish(),
  holdSec: z.number().min(0).max(86_400).nullish(),
  done: z.boolean().default(true),
  // Legado de transição: preserva entries de cardio do check-in (Esteira, Bicicleta…)
  // até o formato `endurance` (Fase 2b). Não fazem parte do strength "de verdade".
  durationMin: z.number().min(0).max(1440).nullish(),
  distanceKm: z.number().min(0).max(1000).nullish(),
});

export const strengthExerciseSchema = z.object({
  name: z.string().min(1).max(120),
  order: z.number().int().min(0).optional(),
  sets: z.array(strengthSetSchema).min(1),
  // De onde o exercício veio e o que ele treina. Os dois são opcionais porque o
  // app instalado não manda nenhum dos dois — e porque o nome sozinho quase
  // sempre resolve (`services/muscleGroups.ts`). Quando vêm, ganham do nome:
  // `exerciseId` é a escolha do catálogo, `muscle` é o que a pessoa marcou.
  exerciseId: z.string().max(60).nullish(),
  muscle: z.enum(MUSCLE_GROUPS).nullish(),
  // A identidade do exercicio, para o historico dele ser um so. Quem preenche e
  // o servidor no salvamento (`services/slug.ts`), nunca o app: o cliente manda
  // o nome como a pessoa escreveu, e o APK instalado nem sabe deste campo.
  slug: z.string().max(80).nullish(),
});

export const strengthPayloadSchema = z.object({
  variant: z.enum(["musculacao", "calistenia", "powerlifting", "lpo"]).default("musculacao"),
  exercises: z.array(strengthExerciseSchema).min(1),
});

export type StrengthPayload = z.infer<typeof strengthPayloadSchema>;
