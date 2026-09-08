import mongoose, { Schema, type HydratedDocument } from "mongoose";
import { z } from "zod";
import { ACTIVITY_KINDS, isValidSport } from "../services/sports.js";

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
});

export const strengthPayloadSchema = z.object({
  variant: z.enum(["musculacao", "calistenia", "powerlifting", "lpo"]).default("musculacao"),
  exercises: z.array(strengthExerciseSchema).min(1),
});

export type StrengthPayload = z.infer<typeof strengthPayloadSchema>;

// ---- Entrada de criação (Fase 2a: só kind "strength") ----

export const activityCreateSchema = z.object({
  sportId: z.string().refine(isValidSport, "Esporte inválido"),
  kind: z.literal("strength"),
  title: z.string().max(120).optional(),
  startedAt: z.coerce.date().optional(),
  durationSec: z.number().int().min(0).max(86_400).optional(),
  visibility: z.enum(["private", "followers", "public"]).default("followers"),
  perceivedEffort: z.number().int().min(1).max(10).optional(),
  feeling: z.enum(["otimo", "bom", "normal", "ruim", "pessimo"]).optional(),
  notes: z.string().max(2000).optional(),
  planLink: z
    .object({ planVersion: z.number().int().min(0), sessionDay: z.string().min(1) })
    .optional(),
  payload: strengthPayloadSchema,
  // Compartilhamento no feed (cria um Post referenciando a atividade).
  shareToFeed: z.boolean().optional(),
  caption: z.string().max(2000).optional(),
});

export type ActivityCreateInput = z.infer<typeof activityCreateSchema>;

// ---- Modelo Mongoose ----

const activitySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sportId: { type: String, required: true, index: true },
    kind: { type: String, enum: ACTIVITY_KINDS, required: true },
    title: { type: String, default: "" },
    startedAt: { type: Date, default: Date.now, index: true },
    durationSec: { type: Number, default: 0 },
    visibility: {
      type: String,
      enum: ["private", "followers", "public"],
      default: "followers",
    },
    perceivedEffort: { type: Number },
    feeling: { type: String },
    notes: { type: String, default: "" },
    // Liga a atividade a uma sessão do plano (herda o papel de adesão do WorkoutLog).
    planLink: {
      type: new Schema(
        { planVersion: { type: Number }, sessionDay: { type: String } },
        { _id: false }
      ),
      default: undefined,
    },
    // Polimórfico por kind (Mixed): validado por zod na borda antes de gravar.
    payload: { type: Schema.Types.Mixed, required: true },
    // Desnormalizado, calculado no save.
    metrics: { type: Schema.Types.Mixed, default: {} },
    // Rastreia a origem quando a atividade veio da migração do WorkoutLog (reversível).
    migratedFrom: { type: Schema.Types.ObjectId, index: true, sparse: true },
  },
  { timestamps: true }
);

export type ActivityDoc = HydratedDocument<{
  user: mongoose.Types.ObjectId;
  sportId: string;
  kind: string;
  title: string;
  startedAt: Date;
  durationSec: number;
  visibility: "private" | "followers" | "public";
  perceivedEffort?: number;
  feeling?: string;
  notes: string;
  planLink?: { planVersion?: number; sessionDay?: string };
  payload: unknown;
  metrics: Record<string, unknown>;
  migratedFrom?: mongoose.Types.ObjectId;
}>;

export const Activity = mongoose.model("Activity", activitySchema);
