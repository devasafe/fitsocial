import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { PRODUTOS, CICLOS } from "../services/pagamentos/catalogo.js";

// O cupom, com DOIS EIXOS INDEPENDENTES.
//
// A tentação é fazer um enum de "tipo de cupom" e acabou. Não serve, porque as
// duas coisas que um cupom faz respondem a perguntas diferentes:
//
//  - DESCONTO mexe no dinheiro que entra. Interessa ao financeiro.
//  - PARCERIA marca DE ONDE a pessoa veio, e fica grudado na conta dela para
//    sempre. Interessa a quem divide lucro com quem trouxe.
//
// Um enum obrigaria a escolher, e o caso mais comum é justamente os dois ao
// mesmo tempo: o cupom do influenciador dá 20% para quem usa E credita a venda
// a ele. Com dois campos opcionais, os três casos saem de graça — só desconto,
// só afiliação, ou os dois — sem nenhuma linha escrita para a combinação.

export const TIPOS_DE_DESCONTO = ["percentual", "valor", "meses_gratis"] as const;
export type TipoDeDesconto = (typeof TIPOS_DE_DESCONTO)[number];

const cupomSchema = new Schema(
  {
    /**
     * O código que a pessoa digita.
     *
     * `uppercase` no schema, e não na rota: assim "joao10", "Joao10" e "JOAO10"
     * são o mesmo cupom em qualquer caminho que chegue — cadastro, checkout ou
     * painel — sem cada um lembrar de normalizar.
     */
    codigo: { type: String, required: true, unique: true, uppercase: true, trim: true },
    /** Para o painel. A pessoa que usa nunca vê. */
    descricao: { type: String, default: "", maxlength: 200 },

    /**
     * O desconto. `null` = o cupom não mexe em preço nenhum.
     *
     * Um cupom só de afiliação é isso: rastreia a origem e não dá nada. Faz
     * sentido para um parceiro que divulga sem oferecer vantagem, e é o que
     * separa "de onde veio" de "quanto pagou".
     */
    desconto: {
      type: {
        tipo: { type: String, enum: TIPOS_DE_DESCONTO, required: true },
        /**
         * Em CENTAVOS para `valor`, em pontos percentuais para `percentual`,
         * em MESES para `meses_gratis`. Inteiro nos três casos — dinheiro em
         * ponto flutuante é como um centavo vira três e ninguém acha de onde.
         */
        valor: { type: Number, required: true, min: 1 },
      },
      default: null,
      _id: false,
    },

    /**
     * O parceiro. `null` = campanha nossa, sem ninguém para pagar.
     *
     * A comissão mora aqui, mas NÃO é lida na hora de pagar o parceiro: cada
     * `Cobranca` grava a comissão vigente no momento da venda. Se a taxa
     * mudar, o histórico não se move junto — senão o relatório de ontem passa a
     * dizer outra coisa hoje.
     */
    parceiro: {
      type: {
        nome: { type: String, required: true, maxlength: 120 },
        contato: { type: String, default: "", maxlength: 200 },
        comissaoPercentual: { type: Number, default: 0, min: 0, max: 100 },
      },
      default: null,
      _id: false,
    },

    /** A que produtos e ciclos ele se aplica. Vazio = todos. */
    produtos: [{ type: String, enum: PRODUTOS }],
    ciclos: [{ type: String, enum: CICLOS }],

    /** Teto de usos. `null` = sem teto. */
    limiteDeUsos: { type: Number, default: null, min: 1 },
    /**
     * Quantas vezes foi usado.
     *
     * Contador desnormalizado para o painel não precisar contar `CupomUso` a
     * cada linha da lista. A verdade é a coleção de usos; este campo é cache, e
     * `recontarUsos` o conserta se divergir.
     */
    usos: { type: Number, default: 0, min: 0 },

    /** Depois disto não vale mais. `null` = sem validade. */
    validoAte: { type: Date, default: null },
    /**
     * Revogado. Não se apaga cupom: quem já entrou por ele continua contando
     * no relatório do parceiro, e apagar reescreveria o passado.
     */
    revogadoEm: { type: Date, default: null },
    revogadoPor: { type: Schema.Types.ObjectId, ref: "User", default: null },

    criadoPor: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// O painel lista por criação, e filtra os que ainda valem.
cupomSchema.index({ revogadoEm: 1, createdAt: -1 });

export type CupomDoc = HydratedDocument<InferSchemaType<typeof cupomSchema>>;

export const Cupom = mongoose.model("Cupom", cupomSchema);
