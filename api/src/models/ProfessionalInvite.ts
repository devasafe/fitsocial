import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { PAPEIS_PRO } from "./ProfessionalLink.js";

// O convite que o coach manda no WhatsApp.
//
// É um código, e não um convite endereçado a alguém, porque o coach quase nunca
// sabe o @username do aluno — e muitas vezes o aluno ainda nem tem conta. Com
// link, quem já tem conta aceita em um toque e quem não tem cria a conta e já
// entra vinculado. É o que transforma cada profissional num canal de entrada:
// dez alunos de um coach são dez contas novas.
//
// O código não é segredo forte: quem tiver o link vira aluno daquele coach. É
// aceitável porque o vínculo não dá acesso a nada de quem entra — ele abre os
// dados do ALUNO para o profissional, e quem aceita é o dono deles. E o convite
// expira, tem teto de usos e pode ser revogado.

const inviteSchema = new Schema(
  {
    professional: { type: Schema.Types.ObjectId, ref: "User", required: true },
    papel: { type: String, enum: PAPEIS_PRO, required: true },
    /**
     * Para quem este convite foi enviado. Nulo = link aberto, que qualquer um
     * com o código usa.
     *
     * Quando tem destinatário, só ELE aceita: o código deixa de ser uma porta e
     * vira um endereço. É o que permite convidar pelo @ sem que o link, se
     * vazar no grupo da academia, traga a turma inteira.
     */
    para: { type: Schema.Types.ObjectId, ref: "User", default: null },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    /** Quantas pessoas ainda podem entrar por este link. */
    usosRestantes: { type: Number, default: 1, min: 0 },
    /** Convite velho no grupo do WhatsApp não pode virar porta aberta eterna. */
    expiraEm: { type: Date, required: true },
    revogadoEm: { type: Date, default: null },
  },
  { timestamps: true }
);

// O índice do código já vem do `unique: true` no campo — declarar de novo aqui
// criaria dois índices iguais na coleção.
// O profissional lista os convites que criou.
inviteSchema.index({ professional: 1, createdAt: -1 });
// E o aluno lista os que recebeu — a tela que faz o convite endereçado chegar.
inviteSchema.index({ para: 1, createdAt: -1 });

export type ProfessionalInviteDoc = HydratedDocument<InferSchemaType<typeof inviteSchema>>;

export const ProfessionalInvite = mongoose.model("ProfessionalInvite", inviteSchema);

/**
 * Código de seis caracteres, sem os que se confundem à mão.
 *
 * Mesmo alfabeto do `joinCode` dos desafios: sem I, O, 0 e 1, porque o código
 * vai ser lido em voz alta e digitado errado. Tenta de novo em caso de colisão,
 * em vez de confiar na sorte.
 */
export async function gerarCodigoDeConvite(): Promise<string> {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let tentativa = 0; tentativa < 10; tentativa++) {
    let code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    if (!(await ProfessionalInvite.exists({ code }))) return code;
  }
  throw new Error("Não foi possível gerar um código de convite");
}
