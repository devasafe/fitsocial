import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";

/** As áreas que têm badge. Uma marca por área: ver o Feed não zera Desafios. */
export const AREAS = ["feed", "explore", "desafios"] as const;
export type Area = (typeof AREAS)[number];

/**
 * A marca d'água de leitura de cada área.
 *
 * Aqui não existe contador. O que fica gravado é só "até onde eu tinha visto",
 * e quantos itens novos há é uma consulta feita na hora
 * (`createdAt > lastSeenAt`). É o que impede o badge de somar duas vezes,
 * travar num número errado ou zerar sozinho: não há saldo para ficar errado.
 *
 * Notificações ficam de fora de propósito — elas já têm `read` por item, que é
 * uma marca mais fina. Duas fontes de verdade para a mesma coisa é como o
 * contador de notificação de qualquer app acaba mentindo.
 */
const readStateSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    area: { type: String, enum: AREAS, required: true },
    lastSeenAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// Uma linha por pessoa por área — e é por este par que toda leitura busca.
readStateSchema.index({ user: 1, area: 1 }, { unique: true });

export type ReadStateDoc = HydratedDocument<InferSchemaType<typeof readStateSchema>>;

export const ReadState = mongoose.model("ReadState", readStateSchema);
