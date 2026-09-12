import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

// O vínculo entre um profissional e um aluno.
//
// É a primeira relação PRIVILEGIADA entre dois usuários do projeto. `Follow`
// não serve: seguir é público, unilateral e não dá acesso a nada além do que já
// era visível. Aqui é o contrário — o vínculo é o que abre treino, dieta e
// medida de uma pessoa para outra, e por isso ele nasce de um aceite explícito
// de quem é dono dos dados.
//
// Quem paga é o profissional. O aluno pode ser free e ainda assim ser
// acompanhado por inteiro: amarrar o acompanhamento ao plano do aluno é o que
// faria o coach voltar para o WhatsApp com planilha.

export const PAPEIS_PRO = ["coach", "nutri"] as const;
export type PapelPro = (typeof PAPEIS_PRO)[number];

export const STATUS_VINCULO = ["ativo", "pausado", "encerrado"] as const;

/**
 * O que o aluno abriu para este profissional.
 *
 * Granular de propósito, e nada é presumido: treino é o mínimo do
 * acompanhamento, mas peso, medida e foto de corpo são dado de saúde e de
 * imagem — o projeto já trata `Profile` assim, com auditoria até para o admin.
 * Um coach não precisa das fotos de alguém para prescrever agachamento.
 */
const escopoSchema = new Schema(
  {
    treinos: { type: Boolean, default: true },
    dieta: { type: Boolean, default: false },
    medidas: { type: Boolean, default: false },
    fotos: { type: Boolean, default: false },
  },
  { _id: false }
);

const linkSchema = new Schema(
  {
    professional: { type: Schema.Types.ObjectId, ref: "User", required: true },
    client: { type: Schema.Types.ObjectId, ref: "User", required: true },
    papel: { type: String, enum: PAPEIS_PRO, required: true },
    status: { type: String, enum: STATUS_VINCULO, default: "ativo" },
    escopo: { type: escopoSchema, default: () => ({}) },
    /** Por qual convite entrou — para o profissional saber o que funcionou. */
    convite: { type: Schema.Types.ObjectId, ref: "ProfessionalInvite" },
    aceitoEm: { type: Date, default: Date.now },
    encerradoEm: { type: Date, default: null },
    /** Quem encerrou: o aluno pode sair, e o profissional pode dispensar. */
    encerradoPor: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// Um vínculo por (profissional, aluno, papel) — a mesma pessoa pode ser
// acompanhada pelo mesmo profissional como coach E como nutri.
linkSchema.index({ professional: 1, client: 1, papel: 1 }, { unique: true });
// A lista de alunos do profissional, que é a tela inicial do painel.
linkSchema.index({ professional: 1, status: 1, aceitoEm: -1 });
// E o caminho inverso, que toda checagem de visibilidade percorre: "quem pode
// ver os dados desta pessoa?".
linkSchema.index({ client: 1, status: 1 });

export type ProfessionalLinkDoc = HydratedDocument<InferSchemaType<typeof linkSchema>>;

export const ProfessionalLink = mongoose.model("ProfessionalLink", linkSchema);
