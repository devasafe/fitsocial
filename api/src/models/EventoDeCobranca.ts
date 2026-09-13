import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { PROVEDORES } from "./Assinatura.js";

// O livro-razão do webhook.
//
// Existe por uma razão só, e ela vale o custo da coleção: **idempotência**.
// Gateway reenvia. Reenvia quando a resposta demora, quando a rede falha,
// quando alguém clica em "reenviar" no painel deles. Sem um registro do que já
// foi processado, um `RENEWAL` reenviado credita mais um mês de graça, e um
// `PAYMENT` reenviado conta a receita duas vezes no relatório.
//
// A trava é o índice único `{provedor, provedorEventoId}`: o handler INSERE
// antes de aplicar, e se a inserção falhar por duplicidade, o evento já foi —
// responde 200 e para. É o banco garantindo, não um `if`.

export const RESULTADOS = ["aplicado", "ignorado", "erro"] as const;

const eventoSchema = new Schema(
  {
    provedor: { type: String, enum: PROVEDORES, required: true },
    /** O id do evento no provedor. É ele que impede o reprocessamento. */
    provedorEventoId: { type: String, required: true },
    /** Já traduzido para o vocabulário daqui, nunca o nome cru do gateway. */
    tipo: { type: String, required: true },

    assinatura: { type: Schema.Types.ObjectId, ref: "Assinatura", default: null },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },

    /**
     * O corpo NÃO é guardado, só o seu hash.
     *
     * `docs/SECURITY.md` não admite dado pessoal em registro de sistema, e
     * payload de gateway vem cheio: nome, documento, e-mail, às vezes os
     * últimos dígitos do cartão. O hash serve ao que a gente precisa de
     * verdade — saber se dois eventos com o mesmo id trouxeram conteúdo
     * diferente.
     */
    payloadHash: { type: String, default: "" },

    recebidoEm: { type: Date, default: Date.now },
    processadoEm: { type: Date, default: null },
    resultado: { type: String, enum: RESULTADOS, default: null },
    erro: { type: String, default: "", maxlength: 500 },
  },
  { timestamps: true }
);

// A trava de idempotência. Único, e sem `sparse`: evento sem id não entra.
eventoSchema.index({ provedor: 1, provedorEventoId: 1 }, { unique: true });
// Para investigar "o que chegou ontem" quando algo não bater.
eventoSchema.index({ recebidoEm: -1 });

export type EventoDeCobrancaDoc = HydratedDocument<InferSchemaType<typeof eventoSchema>>;

export const EventoDeCobranca = mongoose.model("EventoDeCobranca", eventoSchema);
