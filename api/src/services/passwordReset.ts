import crypto from "node:crypto";
import { User, hashPassword, verifyPassword, type UserDoc } from "../models/User.js";
import { PasswordReset } from "../models/PasswordReset.js";
import { getMailer } from "./mail/index.js";
import { HttpError } from "../utils/httpError.js";

/** Curto de propósito: o código vive no e-mail de alguém, e e-mail vaza. */
export const VALIDADE_MS = 15 * 60_000;
/** Depois disso o código morre, mesmo dentro do prazo. */
export const TENTATIVAS_MAX = 5;

function gerarCodigo(): string {
  // randomInt, não Math.random: previsibilidade aqui é conta invadida.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function corpoDoEmail(nome: string, codigo: string): { texto: string; html: string } {
  const minutos = VALIDADE_MS / 60_000;
  const texto =
    `Oi, ${nome}.\n\n` +
    `Seu código para criar uma senha nova no FitSocial:\n\n` +
    `    ${codigo}\n\n` +
    `Ele vale por ${minutos} minutos e só pode ser usado uma vez.\n\n` +
    `Se não foi você que pediu, ignore este e-mail — sua senha atual continua valendo ` +
    `e ninguém consegue entrar sem este código.\n`;

  const html =
    `<p>Oi, ${nome}.</p>` +
    `<p>Seu código para criar uma senha nova no FitSocial:</p>` +
    `<p style="font-size:28px;letter-spacing:6px;font-weight:700">${codigo}</p>` +
    `<p>Ele vale por ${minutos} minutos e só pode ser usado uma vez.</p>` +
    `<p>Se não foi você que pediu, ignore este e-mail — sua senha atual continua ` +
    `valendo e ninguém consegue entrar sem este código.</p>`;

  return { texto, html };
}

/**
 * Começa uma redefinição.
 *
 * Não devolve nada e não diz se o e-mail existe: quem chama responde a mesma
 * coisa nos dois casos. Uma rota que responde diferente para e-mail cadastrado
 * e não cadastrado é uma lista de quem tem conta, servida a quem perguntar.
 */
export async function pedirRedefinicao(email: string): Promise<void> {
  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user) return;

  // Conta banida não redefine senha: seria contornar a punição por e-mail.
  if (user.status === "banned") return;

  // Um código por vez. Pedir de novo invalida o anterior — senão cada pedido
  // deixaria mais uma chave viva por quinze minutos.
  await PasswordReset.deleteMany({ user: user._id });

  const codigo = gerarCodigo();
  await PasswordReset.create({
    user: user._id,
    codeHash: await hashPassword(codigo),
    expiresAt: new Date(Date.now() + VALIDADE_MS),
  });

  const { texto, html } = corpoDoEmail(user.name.split(" ")[0], codigo);
  await getMailer().enviar({
    para: user.email,
    assunto: `${codigo} é seu código do FitSocial`,
    texto,
    html,
  });
}

/**
 * Conclui a redefinição. Devolve o usuário já com a senha nova.
 *
 * A mensagem de erro é a mesma para código errado, vencido e inexistente: dizer
 * "esse código expirou" já confirma que o e-mail tem conta.
 */
export async function redefinirSenha(
  email: string,
  codigo: string,
  nova: string
): Promise<UserDoc> {
  const invalido = new HttpError(400, "Código inválido ou expirado. Peça um novo.");

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user) throw invalido;

  const pedido = await PasswordReset.findOne({
    user: user._id,
    usedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (!pedido) throw invalido;

  if (pedido.attempts >= TENTATIVAS_MAX) {
    await PasswordReset.deleteOne({ _id: pedido._id });
    throw invalido;
  }

  if (!(await verifyPassword(codigo, pedido.codeHash))) {
    // Registra a tentativa ANTES de sair: é a contagem que fecha a porta para
    // quem está chutando.
    pedido.attempts += 1;
    await pedido.save();
    throw invalido;
  }

  user.passwordHash = await hashPassword(nova);
  // Derruba todas as sessões. "Esqueci a senha" muitas vezes quer dizer "alguém
  // entrou na minha conta" — redefinir sem expulsar quem está lá dentro não
  // resolveria nada.
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  await user.save();

  // O código morre no uso, não no vencimento.
  pedido.usedAt = new Date();
  await pedido.save();

  return user;
}
