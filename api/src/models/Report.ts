import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";

export const MOTIVOS_DE_DENUNCIA = [
  "spam",
  "ofensivo",
  "assedio",
  "improprio",
  "odio",
  "enganoso",
  "outro",
] as const;

// Denúncia de conteúdo feita por quem usa o app.
//
// O snapshot existe porque o conteúdo pode sumir antes de alguém analisar: se o
// autor apagar o post depois de denunciado, quem analisa ainda precisa ver o
// que foi denunciado para decidir.
const reportSchema = new Schema(
  {
    reporter: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    targetKind: { type: String, enum: ["post", "comment", "user"], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true, index: true },
    /** Autor do conteúdo denunciado — atalho para a fila não precisar de lookup. */
    targetAuthor: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reason: { type: String, enum: MOTIVOS_DE_DENUNCIA, required: true },
    details: { type: String, default: "", maxlength: 500 },
    status: {
      type: String,
      enum: ["pendente", "analisando", "resolvida", "rejeitada"],
      default: "pendente",
      index: true,
    },
    snapshot: {
      texto: { type: String, default: "" },
      imageUrl: { type: String, default: "" },
      autorLabel: { type: String, default: "" },
    },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
    decision: { type: String, enum: ["removido", "mantido", null], default: null },
  },
  { timestamps: true }
);

// A mesma pessoa não denuncia o mesmo conteúdo duas vezes. Denúncias de pessoas
// diferentes sobre o mesmo alvo são agrupadas na leitura da fila.
reportSchema.index({ reporter: 1, targetKind: 1, targetId: 1 }, { unique: true });
reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ createdAt: -1 });

export type ReportDoc = HydratedDocument<InferSchemaType<typeof reportSchema>>;

export const Report = mongoose.model("Report", reportSchema);
