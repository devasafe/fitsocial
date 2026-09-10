import type { UserDoc } from "../models/User.js";
import { env } from "../config/env.js";

// "Fundadores": amigos que ganham premium de presente. Configurado por env
// (FOUNDER_EMAILS = lista CSV) + uma mensagem pessoal (FOUNDER_MESSAGE).
// Lê o env ao vivo — mudar no Render (e reiniciar) já reflete, e é testável.

const DEFAULT_MESSAGE = `Você é fundador do ${env.appName} 🖤 Obrigado por estar aqui desde o começo.`;

function founderEmails(): string[] {
  return (process.env.FOUNDER_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isFounder(email: string): boolean {
  return founderEmails().includes(email.trim().toLowerCase());
}

export function founderMessage(): string {
  return process.env.FOUNDER_MESSAGE?.trim() || DEFAULT_MESSAGE;
}

/** Garante premium para um fundador (persiste). Chamado no login/registro/me,
 *  então amigos já cadastrados viram premium no próximo acesso — sem migração. */
export async function ensureFounderPremium(user: UserDoc): Promise<void> {
  if (isFounder(user.email) && user.tier !== "premium") {
    user.tier = "premium";
    await user.save();
  }
}
