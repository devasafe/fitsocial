import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";

// Cache/catálogo compartilhado de vídeos de execução por exercício.
// Cresce sob demanda: um miss no cache dispara uma busca no YouTube que é persistida aqui.
const exerciseVideoSchema = new Schema(
  {
    // Chave de cache: nome do exercício normalizado (minúsculas, sem acento, espaços colapsados).
    normalizedName: { type: String, required: true, unique: true, index: true },
    // Nome original que originou a entrada (para depuração/curadoria).
    displayName: { type: String, required: true },
    // ID do vídeo no YouTube. null = "miss" (busca não achou nada) — evita re-buscar sempre.
    youtubeId: { type: String, default: null },
    thumbnailUrl: { type: String, default: "" },
    title: { type: String, default: "" },
    source: { type: String, enum: ["youtube", "curated"], default: "youtube" },
    // true = entrada curada/corrigida manualmente; não deve ser sobrescrita automaticamente.
    pinned: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export type ExerciseVideoDoc = HydratedDocument<InferSchemaType<typeof exerciseVideoSchema>>;

export const ExerciseVideo = mongoose.model("ExerciseVideo", exerciseVideoSchema);
