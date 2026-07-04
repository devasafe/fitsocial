import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";
import { z } from "zod";

// ---- Schema de conteúdo do plano (validado com zod na saída da IA) ----

const exerciseSchema = z.object({
  name: z.string(),
  sets: z.number().int().min(1).max(20),
  reps: z.string(), // "8-12", "até a falha", "30s" etc.
  restSeconds: z.number().int().min(0).max(600),
  notes: z.string().default(""),
});

const sessionSchema = z.object({
  day: z.string(), // "Dia A — Peito e Tríceps", "Segunda" etc.
  focus: z.string(),
  exercises: z.array(exerciseSchema).min(1),
});

const workoutSchema = z.object({
  split: z.string(), // ex.: "Full body 3x", "ABC"
  daysPerWeek: z.number().int().min(1).max(7),
  sessions: z.array(sessionSchema).min(1),
});

const mealItemSchema = z.object({
  food: z.string(),
  quantity: z.string(), // "100g", "1 unidade", "200ml"
});

const mealSchema = z.object({
  name: z.string(), // "Café da manhã"
  timeHint: z.string().default(""), // "07:00", "pós-treino"
  items: z.array(mealItemSchema).min(1),
});

const dietSchema = z.object({
  dailyCalories: z.number().int().min(800).max(6000),
  macros: z.object({
    proteinG: z.number().int().min(0),
    carbsG: z.number().int().min(0),
    fatG: z.number().int().min(0),
  }),
  meals: z.array(mealSchema).min(1),
  notes: z.string().default(""),
});

export const planDataSchema = z.object({
  summary: z.string(), // mensagem do coach resumindo a estratégia
  workout: workoutSchema,
  diet: dietSchema,
  disclaimer: z.string(),
});

export type PlanData = z.infer<typeof planDataSchema>;

// ---- Modelo Mongoose (guarda histórico de versões por usuário) ----

const planSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    version: { type: Number, required: true, default: 1 },
    summary: { type: String, required: true },
    workout: { type: Schema.Types.Mixed, required: true },
    diet: { type: Schema.Types.Mixed, required: true },
    disclaimer: { type: String, required: true },
  },
  { timestamps: true }
);

export type PlanDoc = HydratedDocument<InferSchemaType<typeof planSchema>>;

export const Plan = mongoose.model("Plan", planSchema);
