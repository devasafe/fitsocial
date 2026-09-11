import mongoose, { Schema, type HydratedDocument } from "mongoose";
import { z } from "zod";
import { ACTIVITY_KINDS, isValidSport } from "../services/sports.js";
import { strengthPayloadSchema } from "./strength.js";
import { wodPayloadEntrada } from "./crossfit.js";

// Força e CrossFit moram em arquivos próprios: o primeiro porque os dois o
// usam, o segundo porque é o formato mais rico do projeto.
export {
  STRENGTH_SET_TYPES,
  strengthSetSchema,
  strengthExerciseSchema,
  strengthPayloadSchema,
  type StrengthPayload,
} from "./strength.js";

// ---- Payloads dos demais formatos (Fase 2b, caminho rápido) ----
// Nível mínimo do docs/ESPORTES.md §5/§7/§8. GPS/rota (Fase 3), intervalos,
// SWOLF, submissions, etc. ficam para fatias posteriores.

export const endurancePayloadSchema = z.object({
  subType: z
    .enum(["rua", "trilha", "esteira", "indoor", "piscina", "aguas_abertas", "ergometro", "escada"])
    .optional(),
  distanceM: z.number().min(0).max(1_000_000).default(0),
  elevationGainM: z.number().min(0).max(30_000).nullish(),
  // Track de GPS (Fase 3a): quando presente, distância/tempo/melhores trechos
  // são derivados dele no servidor.
  points: z
    .array(
      z.object({
        lat: z.number(),
        lng: z.number(),
        t: z.number().optional(),
        ele: z.number().optional(),
      })
    )
    .max(100_000)
    .optional(),
});
export type EndurancePayload = z.infer<typeof endurancePayloadSchema>;

export const classPayloadSchema = z.object({
  modality: z.string().min(1).max(60),
  sessionType: z
    .enum([
      "tecnica",
      "drill",
      "sparring",
      "aula_completa",
      "condicionamento",
      "competicao",
      "seminario",
      "open_mat",
    ])
    .optional(),
  gi: z.boolean().nullish(),
  rounds: z.number().int().min(0).max(100).nullish(),
});
export type ClassPayload = z.infer<typeof classPayloadSchema>;

export const genericPayloadSchema = z.object({
  activityName: z.string().min(1).max(80),
  description: z.string().max(2000).nullish(),
  customMetrics: z
    .array(
      z.object({
        label: z.string().min(1).max(40),
        value: z.string().min(1).max(40),
        unit: z.string().max(20).nullish(),
      })
    )
    .max(3)
    .optional(),
});
export type GenericPayload = z.infer<typeof genericPayloadSchema>;

/**
 * O payload de um treino de CrossFit.
 *
 * Aqui viviam DOIS formatos, unidos: o v2 em blocos e um v1 plano, aceito
 * porque havia APK instalado mandando ele. Os dois foram embora em 11/09/2026
 * — o v1 com a decisão de não carregar compatibilidade com o APK 1.2.0, e o v2
 * com a reescrita para `modo` em texto livre.
 *
 * Sobrou um formato só, e com ele sumiu a pergunta "de qual formato veio isto?"
 * que atravessava métricas, PR, cards e detalhe.
 */
export const wodPayloadSchema = wodPayloadEntrada;
export type WodPayload = z.infer<typeof wodPayloadEntrada>;

// ---- Entrada de criação (união discriminada por kind) ----

const baseCreateFields = {
  sportId: z.string().refine(isValidSport, "Esporte inválido"),
  title: z.string().max(120).optional(),
  startedAt: z.coerce.date().optional(),
  durationSec: z.number().int().min(0).max(86_400).optional(),
  // Sem default de propósito: quando a pessoa não escolhe explicitamente, quem
  // decide é a preferência dela (services/activityVisibility.ts). Com default
  // aqui, "não escolheu" viraria indistinguível de "escolheu seguidores".
  visibility: z.enum(["private", "followers", "public"]).optional(),
  perceivedEffort: z.number().int().min(1).max(10).optional(),
  feeling: z.enum(["otimo", "bom", "normal", "ruim", "pessimo"]).optional(),
  notes: z.string().max(2000).optional(),
  planLink: z
    .object({ planVersion: z.number().int().min(0), sessionDay: z.string().min(1) })
    .optional(),
  // Compartilhamento no feed (cria um Post referenciando a atividade).
  shareToFeed: z.boolean().optional(),
  caption: z.string().max(2000).optional(),
};

export const activityCreateSchema = z.discriminatedUnion("kind", [
  z.object({ ...baseCreateFields, kind: z.literal("strength"), payload: strengthPayloadSchema }),
  z.object({ ...baseCreateFields, kind: z.literal("endurance"), payload: endurancePayloadSchema }),
  z.object({ ...baseCreateFields, kind: z.literal("class"), payload: classPayloadSchema }),
  z.object({ ...baseCreateFields, kind: z.literal("generic"), payload: genericPayloadSchema }),
  z.object({ ...baseCreateFields, kind: z.literal("wod"), payload: wodPayloadSchema }),
]);

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
