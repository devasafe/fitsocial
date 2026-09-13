import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { PRODUTOS, CICLOS } from "../services/pagamentos/catalogo.js";

// O ciclo de vida comercial de quem paga.
//
// Separada do `User` de propósito. O `User` guarda DIREITOS — até quando vale,
// que produto, que capacidade — porque é isso que `calcularPlan` precisa ler a
// cada requisição, sem consulta. Aqui mora a VERDADE DA COBRANÇA: o que foi
// vendido, por quanto, por qual provedor, e o que aconteceu com isso. Um é
// cache do outro, e quando os dois discordarem, esta coleção ganha.

export const STATUS_DA_ASSINATURA = [
  "pendente",
  "ativa",
  "inadimplente",
  "cancelada",
  "expirada",
  "estornada",
] as const;

/** Quem processou. Carimbado na criação e nunca mais tocado. */
export const PROVEDORES = ["asaas", "manual", "revenuecat"] as const;
export type Provedor = (typeof PROVEDORES)[number];

const assinaturaSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    produto: { type: String, enum: PRODUTOS, required: true },
    ciclo: { type: String, enum: CICLOS, required: true },
    status: { type: String, enum: STATUS_DA_ASSINATURA, default: "pendente" },

    /**
     * O provedor que originou esta assinatura.
     *
     * Carimbado, como o `Order.paymentProvider` do DROP: trocar de gateway
     * afeta só as assinaturas NOVAS, e as antigas continuam sendo lidas por
     * quem as criou. Sem isto, migrar de provedor obrigaria a migrar o
     * histórico — e histórico de cobrança não se migra.
     */
    provedor: { type: String, enum: PROVEDORES, required: true },
    provedorAssinaturaId: { type: String, default: null },
    provedorClienteId: { type: String, default: null },

    /** Em centavos, sempre. O desconto é o que o cupom tirou. */
    precoCentavos: { type: Number, required: true, min: 0 },
    descontoCentavos: { type: Number, default: 0, min: 0 },
    cupom: { type: String, default: null, uppercase: true, trim: true },

    inicioEm: { type: Date, default: null },
    /** Até quando o acesso vale. É daqui que sai o `User.assinaturaAte`. */
    validoAte: { type: Date, default: null },
    renovaEm: { type: Date, default: null },

    /**
     * Cancelar não é estornar.
     *
     * Quem cancela continua com acesso até o fim do ciclo que já pagou — ele
     * comprou aquele mês. Quem estorna perde na hora, porque o dinheiro voltou.
     */
    cancelaNoFimDoCiclo: { type: Boolean, default: false },
    canceladaEm: { type: Date, default: null },
    motivoCancelamento: { type: String, default: "", maxlength: 300 },

    /** Troca de plano: de onde veio e para onde foi, para a conta fechar. */
    trocadaDe: { type: Schema.Types.ObjectId, ref: "Assinatura", default: null },
    trocadaPor: { type: Schema.Types.ObjectId, ref: "Assinatura", default: null },

    /**
     * Quando chegou o último evento aplicado.
     *
     * Gateway reenvia e REORDENA. Sem isto, um "renovou" atrasado chegando
     * depois de um "cancelou" ressuscita a assinatura — e ninguém consegue
     * reproduzir, porque depende da ordem em que a rede entregou.
     */
    ultimoEventoEm: { type: Date, default: null },
  },
  { timestamps: true }
);

// "As assinaturas desta pessoa, a ativa primeiro" — a consulta do app.
assinaturaSchema.index({ user: 1, status: 1, createdAt: -1 });
// O webhook chega com o id do provedor e precisa achar a assinatura por ele.
assinaturaSchema.index(
  { provedor: 1, provedorAssinaturaId: 1 },
  { unique: true, sparse: true }
);
// A varredura de reconciliação: quem venceu e ainda está marcada como ativa.
assinaturaSchema.index({ status: 1, validoAte: 1 });

export type AssinaturaDoc = HydratedDocument<InferSchemaType<typeof assinaturaSchema>>;

export const Assinatura = mongoose.model("Assinatura", assinaturaSchema);
