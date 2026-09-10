import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";

export const NOTIFICATION_TYPES = [
  "like",
  "comment",
  "follow",
  "challenge_join",
  /** Seu post saiu do ar por moderação. */
  "post_removido",
  /** A denúncia que você fez foi analisada. */
  "denuncia_resolvida",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true }, // destinatário
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    /** Quem gerou. Nulo quando quem gerou foi a moderação: dizer qual
     *  administrador removeu o post transforma uma decisão da plataforma em
     *  briga com uma pessoa. */
    actor: { type: Schema.Types.ObjectId, ref: "User", default: null },
    text: { type: String, required: true },
    targetKind: { type: String, default: "" }, // "post" | "challenge" | "profile"
    targetId: { type: Schema.Types.ObjectId },
    read: { type: Boolean, default: false, index: true },

    /** Identidade do assunto: `like:post:<id>`. Duas curtidas no mesmo post
     *  compartilham a chave e viram uma linha só. */
    groupKey: { type: String, default: "" },
    /** Quem participou deste assunto, sem repetir. É daqui que sai o "e mais 3":
     *  contar eventos diria "3 pessoas comentaram" para a mesma pessoa
     *  comentando três vezes. */
    actors: { type: [Schema.Types.ObjectId], ref: "User", default: [] },
  },
  { timestamps: true }
);

// Agrupar procura por destinatário + assunto, e sempre entre as não lidas.
notificationSchema.index({ user: 1, groupKey: 1, read: 1 });

export type NotificationDoc = HydratedDocument<InferSchemaType<typeof notificationSchema>>;
export const Notification = mongoose.model("Notification", notificationSchema);
