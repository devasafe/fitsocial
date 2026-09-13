import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";
import bcrypt from "bcryptjs";

/** Uma capacidade profissional: se está ativa, por quê, até quando, e o teto. */
const capacidadeSchema = new Schema(
  {
    ativo: { type: Boolean, default: false },
    /** Quem deu: liberação manual no painel ou compra. */
    origem: { type: String, enum: ["manual", "gateway", null], default: null },
    /** Fim do acesso. null = sem prazo. */
    validoAte: { type: Date, default: null },
    /**
     * Quantos alunos esta pessoa pode acompanhar.
     *
     * O número vive no documento, e não numa constante, porque é o que permite
     * abrir exceção para um coach sem mexer no código — e é por onde a cobrança
     * por faixa entra depois, sem migração.
     */
    limiteDeAlunos: { type: Number, default: 10 },
  },
  { _id: false }
);

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
      /** De onde vem o treino da pessoa.
       *
       *  "plano"   = o plano que o app gera
       *  "propria" = programação do box, do treinador ou dela mesma
       *  null      = ainda não escolheu
       *
       *  Existe porque o app assumia que todo mundo quer um plano gerado. Quem
       *  faz CrossFit recebe a programação do box: pedir para gerar um plano de
       *  musculação antes de deixar usar qualquer coisa é atrito puro, logo na
       *  primeira tela. */
      programacao: { type: String, enum: ["plano", "propria", null], default: null },
      /** O que a pessoa quer receber. Preparado para as notificações da
       *  próxima fase; hoje só é lido e gravado. */
      notificacoes: {
        novosPosts: { type: Boolean, default: true },
        interacoes: { type: Boolean, default: true },
        desafios: { type: Boolean, default: true },
        sistema: { type: Boolean, default: true },
      },
    },
    /** Sobe a cada troca de senha, derrubando as sessões antigas.
     *
     *  Tokens emitidos antes disto existir não trazem o campo. Por isso a
     *  comparação usa (payload.v ?? 0) contra o default 0: subir esta versão
     *  não desloga ninguém que já estava dentro. */
    tokenVersion: { type: Number, default: 0 },

    // --- Assinatura ---
    // `tier` continua sendo a verdade que o app lê; estes campos dizem POR QUE
    // a pessoa é premium, para o webhook da loja não derrubar uma cortesia.
    premiumSource: {
      type: String,
      // "patrocinio": um profissional banca o Pro deste aluno. Tem origem
      // própria para a conta nunca ser confundida com premium legado sem
      // origem — o que a faria ficar premium para sempre depois que o
      // acompanhamento acabasse.
      enum: ["purchase", "admin", "founder", "patrocinio", null],
      default: null,
    },
    /** Fim da cortesia. null = sem prazo. */
    premiumUntil: { type: Date, default: null },

    /**
     * O plano do consumidor. `tier` passa a ser DERIVADO disto.
     *
     * Nasceu ao lado de `tier` em vez de substituí-lo porque o APK instalado lê
     * `tier` em `publicUser()` e compara com "premium": trocar o campo
     * rebaixaria, em silêncio, todo mundo que paga. Quem tem conta antiga não
     * tem este campo — `planDoUsuario` deriva do `tier` dela até o backfill.
     *
     * SEM `default` de propósito. O mongoose aplica default ao HIDRATAR, não só
     * ao criar: com `default: "free"`, um documento antigo sem o campo seria
     * lido como free, e quem paga cairia para free na primeira gravação. A
     * ausência precisa continuar sendo ausência para poder ser derivada.
     */
    plan: { type: String, enum: ["free", "pro", "pro_plus"] },

    // --- Assinatura paga (gateway) ---
    //
    // Campos PRÓPRIOS, e não `premiumUntil` reaproveitado. `revogarPremium`
    // zera `premiumSource`/`premiumUntil` incondicionalmente: se o gateway
    // escrevesse ali, tirar uma cortesia do painel apagaria uma assinatura
    // paga — e ninguém descobriria até a pessoa reclamar que perdeu o que
    // comprou.
    //
    // Sem `default` que possa ser lido como rebaixamento, pela mesma razão que
    // `plan` não tem: `null` aqui significa "não tem assinatura", e é verdade.
    /** Fim do ciclo pago corrente. */
    assinaturaAte: { type: Date, default: null },
    assinaturaStatus: {
      type: String,
      enum: ["ativa", "inadimplente", "cancelada", "expirada", null],
      default: null,
    },
    /** O SKU comprado. Mora aqui como cache para o gate não consultar a
     *  `Assinatura`; a verdade da cobrança continua sendo ela. */
    produtoAssinado: {
      type: String,
      enum: ["pro", "pro_coach", "pro_nutri", "pro_plus", null],
      default: null,
    },

    /**
     * Fim dos meses grátis de CUPOM.
     *
     * Separado de `premiumUntil` porque são coisas diferentes que o painel
     * precisa distinguir: "ganhou 3 meses pelo cupom de um parceiro" não é "o
     * suporte deu uma cortesia" — e revogar um não pode apagar o outro.
     */
    cortesiaAte: { type: Date, default: null },

    /**
     * Quantos profissionais bancam o Pro desta pessoa agora.
     *
     * CONTADOR, e não booleano: alguém pode ter treinador E nutricionista, e
     * com um booleano encerrar um dos dois derrubaria o Pro que o outro ainda
     * sustenta.
     *
     * É a única fonte de direito que não cabe no documento — vínculo é
     * relacional. Desnormalizar só ela é o que mantém `calcularPlan` uma
     * função pura, sem consulta, dentro do `requireAuth`.
     *
     * AINDA NÃO É ESCRITO por ninguém: quem passa a mexer nele é o
     * `aceitarConvite`/`encerrarVinculo` da fase do patrocínio. Até lá o campo
     * existe, vale zero, e o ramo correspondente de `calcularPlan` fica inerte.
     */
    vinculosPatrocinados: { type: Number, default: 0, min: 0 },

    /** Quando o cache derivado (`plan`/`tier`) foi recalculado pela última
     *  vez. Evita reescrever o mesmo valor a cada requisição. */
    direitosCalculadoEm: { type: Date, default: null },

    // --- Capacidade profissional (RUMO Pro) ---
    //
    // Fica FORA de `role` de propósito. `role` é enum único e, neste projeto, é
    // privilégio concedido por script — e uma pessoa pode ser coach e nutri ao
    // mesmo tempo, além de continuar sendo aluna. São eixos diferentes:
    // `role` é privilégio, `plan` é o que a pessoa comprou para si, e isto aqui
    // é o que ela pode fazer COM OS OUTROS.
    pro: {
      coach: { type: capacidadeSchema, default: () => ({}) },
      nutri: { type: capacidadeSchema, default: () => ({}) },
    },
  },
  { timestamps: true }
);

/**
 * `tier` é derivado de `plan` — e a derivação mora aqui para não haver como
 * esquecer dela.
 *
 * Deixar isso só no service significaria que qualquer `save()` que mexesse em
 * `plan` sem passar por lá deixaria os dois campos discordando: a pessoa com
 * `plan: "pro"` e `tier: "free"` perderia o acesso que comprou, e nada
 * apontaria o erro. O hook só age quando `plan` muda, então conta antiga (que
 * não tem o campo) segue intocada.
 */
userSchema.pre("save", function (next) {
  if (this.isModified("plan") && this.plan) {
    this.tier = this.plan === "free" ? "free" : "premium";
  }
  next();
});

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
    // Aditivo: o APK antigo ignora o que não conhece, e o app novo usa isto
    // para saber se mostra a entrada do painel profissional.
    plan: user.plan ?? "free",
    pro: {
      coach: user.pro?.coach?.ativo === true,
      nutri: user.pro?.nutri?.ativo === true,
    },
    onboardingComplete: user.onboardingComplete,
    settings: {
      // null aqui é o que faz o app perguntar na conclusão do primeiro treino.
      activitiesPublic: user.settings?.activitiesPublic ?? null,
      routesPublic: user.settings?.routesPublic ?? false,
      // A Home lê isto para saber se cobra um plano ou oferece registrar.
      programacao: user.settings?.programacao ?? null,
    },
  };
}

// O painel lista por data de cadastro e filtra por status/tier.
userSchema.index({ createdAt: -1 });
userSchema.index({ status: 1, createdAt: -1 });

export const User = mongoose.model("User", userSchema);
