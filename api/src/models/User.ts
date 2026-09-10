import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true },
    username: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 20,
    },
    avatarUrl: { type: String, default: "" },
    bio: { type: String, default: "", maxlength: 160 },
    tier: { type: String, enum: ["free", "premium"], default: "free" },
    // Marca se a pessoa já concluiu o onboarding conversacional (Fatia 2).
    onboardingComplete: { type: Boolean, default: false },
    // Meta diária de água em ml (0 = não definida → app usa sugestão pelo peso).
    waterGoalMl: { type: Number, default: 0 },
    // Papel administrativo. Só muda por script (scripts/grantAdmin.ts) — nunca
    // por rota, nunca por env: tier é presente, role é privilégio.
    role: { type: String, enum: ["user", "admin"], default: "user", index: true },

    // --- Moderação ---
    status: {
      type: String,
      enum: ["active", "suspended", "banned"],
      default: "active",
      index: true,
    },
    /** Motivo da última mudança de status. Interno: nunca vai para o app. */
    statusReason: { type: String, default: "", maxlength: 500 },
    statusChangedAt: { type: Date, default: null },
    statusChangedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    /** Fim da suspensão. Vencido, a conta se libera sozinha no próximo acesso. */
    suspendedUntil: { type: Date, default: null },
    /** false = conteúdo some do feed dos outros, sem nada ser apagado. */
    contentVisible: { type: Boolean, default: true, index: true },
    /** Marca a conta como excluída (LGPD). Separado de banir. */
    deletedAt: { type: Date, default: null },
    /** Última vez que a pessoa usou o app. Alimenta o painel; escrito no
     *  máximo a cada 10 minutos para não pesar em toda requisição. */
    lastSeenAt: { type: Date, default: null, index: true },

    // --- Preferências ---
    settings: {
      /** Treinos aparecem no perfil para outras pessoas.
       *
       *  null = ainda não perguntamos. Enquanto for null, nada fica público:
       *  ninguém deve ter conteúdo exposto por omissão, só por escolha. A
       *  pergunta aparece na conclusão do primeiro treino. */
      activitiesPublic: { type: Boolean, default: null },
      /** Traçado de GPS visível para terceiros.
       *
       *  Separado de activitiesPublic de propósito: "correu 6 km em 32 min" é
       *  resultado, mas a rota começa e termina na porta de casa. No mesmo
       *  botão, alguém publicaria o endereço achando que publicou o tempo. */
      routesPublic: { type: Boolean, default: false },
    },

    // --- Assinatura ---
    // `tier` continua sendo a verdade que o app lê; estes campos dizem POR QUE
    // a pessoa é premium, para o webhook da loja não derrubar uma cortesia.
    premiumSource: {
      type: String,
      enum: ["purchase", "admin", "founder", null],
      default: null,
    },
    /** Fim da cortesia. null = sem prazo. */
    premiumUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Remove campos sensíveis antes de enviar o usuário na resposta. */
export function publicUser(user: UserDoc) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    username: user.username ?? null,
    avatarUrl: user.avatarUrl ?? "",
    bio: user.bio ?? "",
    tier: user.tier,
    onboardingComplete: user.onboardingComplete,
    settings: {
      // null aqui é o que faz o app perguntar na conclusão do primeiro treino.
      activitiesPublic: user.settings?.activitiesPublic ?? null,
      routesPublic: user.settings?.routesPublic ?? false,
    },
  };
}

// O painel lista por data de cadastro e filtra por status/tier.
userSchema.index({ createdAt: -1 });
userSchema.index({ status: 1, createdAt: -1 });

export const User = mongoose.model("User", userSchema);
