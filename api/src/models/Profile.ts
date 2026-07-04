import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";
import { z } from "zod";

// Valores permitidos, reutilizados na validação da IA e no schema do Mongo.
export const GOALS = ["perder_gordura", "ganhar_massa", "saude_geral", "performance"] as const;
export const SEXES = ["masculino", "feminino", "outro"] as const;
export const LEVELS = ["iniciante", "intermediario", "avancado"] as const;

/**
 * Ficha estruturada que a IA preenche no onboarding. É o contrato que o motor
 * de geração de plano (Fatia 3) consome. `experienceLevel` = iniciante captura
 * o público "não-fitness"; avançado captura o "fitness".
 */
export const profileDataSchema = z.object({
  goal: z.enum(GOALS),
  sex: z.enum(SEXES),
  age: z.number().int().min(12).max(100),
  heightCm: z.number().min(100).max(250),
  weightKg: z.number().min(30).max(400),
  experienceLevel: z.enum(LEVELS),
  daysPerWeek: z.number().int().min(1).max(7),
  sessionMinutes: z.number().int().min(10).max(240),
  dietaryRestrictions: z.array(z.string()).default([]),
  injuriesConditions: z.array(z.string()).default([]),
  notes: z.string().default(""),
});

export type ProfileData = z.infer<typeof profileDataSchema>;

const profileSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    goal: { type: String, enum: GOALS, required: true },
    sex: { type: String, enum: SEXES, required: true },
    age: { type: Number, required: true },
    heightCm: { type: Number, required: true },
    weightKg: { type: Number, required: true },
    experienceLevel: { type: String, enum: LEVELS, required: true },
    daysPerWeek: { type: Number, required: true },
    sessionMinutes: { type: Number, required: true },
    dietaryRestrictions: { type: [String], default: [] },
    injuriesConditions: { type: [String], default: [] },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

export type ProfileDoc = HydratedDocument<InferSchemaType<typeof profileSchema>>;

export const Profile = mongoose.model("Profile", profileSchema);
