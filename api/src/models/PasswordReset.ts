import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";

/**
 * Um pedido de redefinição de senha em aberto.
 *
 * O código NÃO é guardado — só o hash dele, como senha. Quem puser a mão no
 * banco leva hashes, não contas: o código de seis dígitos existe apenas no
 * e-mail da pessoa e na memória do servidor durante o envio.
 *
 * `attempts` é o que impede a força bruta. Seis dígitos são um milhão de
 * combinações, o que um script vence em minutos; com teto de tentativas e
 * quinze minutos de validade, a chance de acerto cai para 5 em um milhão.
 */
const passwordResetSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    /** Preenchido no uso. Um código serve uma vez só. */
    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// O Mongo apaga sozinho o que venceu. Guardar pedido morto não serve a
// ninguém, e um banco cheio de códigos expirados é só superfície de ataque.
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type PasswordResetDoc = HydratedDocument<InferSchemaType<typeof passwordResetSchema>>;
export const PasswordReset = mongoose.model("PasswordReset", passwordResetSchema);
