import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

// Quem entrou por qual cupom, e o que fez depois.
//
// Uma linha por pessoa por cupom, criada no CADASTRO — não no pagamento. É a
// diferença entre as duas perguntas que o parceiro faz:
//
//   "quantas pessoas eu trouxe?"  -> conta linhas aqui
//   "quantas delas pagaram?"      -> conta as que têm `primeiraCompraEm`
//
// Se o cupom só fosse registrado no checkout, a primeira pergunta não teria
// resposta e não haveria como reconstruí-la depois: quem se cadastrou pelo
// parceiro e ficou no plano grátis seria invisível.

const cupomUsoSchema = new Schema(
  {
    /** O CÓDIGO, e não o ObjectId. O relatório é por código, e ele nunca muda. */
    cupom: { type: String, required: true, uppercase: true, trim: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },

    /** Onde a pessoa digitou. Um cupom de afiliação só aparece no cadastro. */
    origem: { type: String, enum: ["cadastro", "checkout"], required: true },

    /**
     * Quando esta pessoa pagou pela primeira vez. `null` enquanto está no
     * grátis — e é exatamente esse null que o relatório de parceria conta.
     */
    primeiraCompraEm: { type: Date, default: null },
    /** Soma do que ela já pagou, em centavos. Cresce a cada renovação. */
    totalPagoCentavos: { type: Number, default: 0, min: 0 },
    /** Soma do que o parceiro já ganhou com ela. */
    comissaoTotalCentavos: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// "Um cupom por pessoa" sai de graça do banco, e não de um `if` que uma
// corrida vence: dois cadastros simultâneos com o mesmo código não criam duas
// linhas.
cupomUsoSchema.index({ cupom: 1, user: 1 }, { unique: true });
// O relatório do parceiro: os usos daquele cupom, os mais recentes primeiro.
cupomUsoSchema.index({ cupom: 1, createdAt: -1 });
// E a ficha da pessoa no painel: por qual cupom ela entrou.
cupomUsoSchema.index({ user: 1 });

export type CupomUsoDoc = HydratedDocument<InferSchemaType<typeof cupomUsoSchema>>;

export const CupomUso = mongoose.model("CupomUso", cupomUsoSchema);
