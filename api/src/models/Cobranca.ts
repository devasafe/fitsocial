import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { PROVEDORES } from "./Assinatura.js";

// Uma linha por fatura. É a tabela que sustenta qualquer relatório de dinheiro.
//
// Antes disto o webhook não persistia NADA: ele mutava o `User` e respondia
// 200. Não havia como auditar receita, conferir com o extrato do gateway, nem
// reprocessar um evento perdido — e "quanto entrou este mês" só existia dentro
// do painel do provedor.

export const STATUS_DA_COBRANCA = [
  "pendente",
  "paga",
  "falhou",
  "estornada",
  "chargeback",
] as const;

export const METODOS = ["pix", "cartao", "boleto", "manual"] as const;

const cobrancaSchema = new Schema(
  {
    assinatura: { type: Schema.Types.ObjectId, ref: "Assinatura", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },

    provedor: { type: String, enum: PROVEDORES, required: true },
    /** Nem toda cobrança tem id do provedor (a nossa, pendente, ainda não). */
    provedorCobrancaId: { type: String },

    /** Tudo em centavos. `liquido` é o que sobrou depois da taxa do gateway. */
    valorCentavos: { type: Number, required: true, min: 0 },
    descontoCentavos: { type: Number, default: 0, min: 0 },
    liquidoCentavos: { type: Number, default: null },

    status: { type: String, enum: STATUS_DA_COBRANCA, default: "pendente" },
    metodo: { type: String, enum: METODOS, default: null },
    /** Qual tentativa de cobrar esta fatura. Cartão recusado gera a segunda. */
    tentativa: { type: Number, default: 1, min: 1 },

    vencimentoEm: { type: Date, default: null },
    pagoEm: { type: Date, default: null },

    cupom: { type: String, default: null, uppercase: true, trim: true },
    /**
     * Quanto esta venda rende ao parceiro do cupom.
     *
     * Gravado NO MOMENTO da cobrança, e não derivado depois: a comissão
     * combinada com o parceiro pode mudar, e o histórico não pode se mover
     * junto — senão o relatório de ontem passa a dizer outra coisa hoje.
     */
    parceiroComissaoCentavos: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// O par que o webhook usa para achar a fatura que o evento menciona.
//
// PARCIAL, e não `sparse`. Num índice COMPOSTO, `sparse` só ignora o documento
// que não tem NENHUM dos campos indexados — com `provedor` presente e
// `provedorCobrancaId` ausente, o documento entra no índice mesmo assim, com
// `null` no lugar do que falta. Duas cobranças sem id do provedor colidiam, e
// o erro subia de dentro do webhook: o evento era registrado como "erro" no
// livro-razão e NADA era aplicado. Na prática, uma cobrança recusada não
// marcava a conta como inadimplente, e ninguém ficava sabendo.
cobrancaSchema.index(
  { provedor: 1, provedorCobrancaId: 1 },
  { unique: true, partialFilterExpression: { provedorCobrancaId: { $type: "string" } } }
);
// "O que entrou no período", que é a consulta de todo relatório de receita.
cobrancaSchema.index({ status: 1, pagoEm: -1 });
// E o mesmo recorte por cupom, para o painel de parceria.
cobrancaSchema.index({ cupom: 1, status: 1, pagoEm: -1 });

export type CobrancaDoc = HydratedDocument<InferSchemaType<typeof cobrancaSchema>>;

export const Cobranca = mongoose.model("Cobranca", cobrancaSchema);
