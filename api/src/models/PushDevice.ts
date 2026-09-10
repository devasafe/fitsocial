import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";

/**
 * Um aparelho registrado para receber push.
 *
 * A chave é o token, não o usuário: o mesmo celular pode trocar de dono (venda,
 * conta de teste, alguém emprestando o telefone), e quando isso acontece o
 * registro tem que mudar de dono junto — senão o novo usuário recebe as
 * notificações do antigo.
 */
const pushDeviceSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    /** ExpoPushToken[...] — devolvido pelo app. */
    token: { type: String, required: true, unique: true },
    platform: { type: String, enum: ["ios", "android"], required: true },
    /** Última vez que o app confirmou que este registro continua vivo. */
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export type PushDeviceDoc = HydratedDocument<InferSchemaType<typeof pushDeviceSchema>>;
export const PushDevice = mongoose.model("PushDevice", pushDeviceSchema);

/**
 * Quando cada pessoa recebeu push de cada assunto.
 *
 * É o que segura o "quem você segue publicou": sem essa marca, seguir 50
 * pessoas ativas significaria 50 interrupções por dia, e a pessoa desliga tudo
 * na primeira noite. Uma linha por par, sobrescrita a cada envio.
 */
const pushCooldownSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  assunto: { type: String, required: true },
  ultimoEnvioAt: { type: Date, required: true },
});

pushCooldownSchema.index({ user: 1, assunto: 1 }, { unique: true });

export const PushCooldown = mongoose.model("PushCooldown", pushCooldownSchema);
