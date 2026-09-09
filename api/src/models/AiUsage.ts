import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";
import { env } from "../config/env.js";

// Uma linha por chamada à IA — inclusive as que falharam, porque é a falha que
// revela quando uma chave estourou a quota e a cadeia caiu para a próxima.
//
// ATENÇÃO: nunca gravar a chave de API aqui. `keyLabel` é só a posição dela na
// env (ex.: "gemini#1"); o SECURITY.md proíbe segredo em log, e isto é log.
const aiUsageSchema = new Schema(
  {
    provider: { type: String, required: true },
    model: { type: String, required: true },
    keyLabel: { type: String, required: true, index: true },
    keyFingerprint: { type: String, default: "" },
    chainIndex: { type: Number, default: 0 },
    feature: {
      type: String,
      enum: ["coach", "onboarding", "plan_generate", "plan_adjust", "plan_import"],
    },
    user: { type: Schema.Types.ObjectId, ref: "User", index: true },
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    ok: { type: Boolean, required: true },
    errorKind: {
      type: String,
      enum: ["quota", "auth", "server", "network", "timeout", "blocked", "empty", "other"],
      default: null,
    },
  },
  { timestamps: true }
);

// O painel lê sempre por janela de tempo, daí createdAt na frente de cada índice.
aiUsageSchema.index({ createdAt: -1 });
aiUsageSchema.index({ keyLabel: 1, createdAt: -1 });
aiUsageSchema.index({ provider: 1, createdAt: -1 });
aiUsageSchema.index({ feature: 1, createdAt: -1 });

// Esta é a coleção que mais cresce, num Mongo self-hosted em VPS pequena: uma
// linha por chamada de IA, para sempre, enche o disco. O TTL descarta o detalhe
// antigo. Quando existir agregado diário, este prazo pode encurtar sem perder
// histórico — hoje ele É o histórico, por isso o default é generoso.
aiUsageSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: env.aiUsageRetentionDays * 24 * 60 * 60 }
);

export type AiUsageDoc = HydratedDocument<InferSchemaType<typeof aiUsageSchema>>;

export const AiUsage = mongoose.model("AiUsage", aiUsageSchema);
