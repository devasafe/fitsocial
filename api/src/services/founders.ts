import type { UserDoc } from "../models/User.js";
import { env } from "../config/env.js";

// "Fundadores": amigos que ganham premium de presente. Configurado por env
// (FOUNDER_EMAILS = lista CSV) + uma mensagem pessoal (FOUNDER_MESSAGE).
// Lê o env ao vivo — mudar no Render (e reiniciar) já reflete, e é testável.

const DEFAULT_MESSAGE = `Você é fundador do ${env.appName} 🖤 Obrigado por estar aqui desde o começo.`;

export function founderEmails(): string[] {
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

// `ensureFounderPremium` morava aqui e foi removida em 12/09/2026.
//
// Ela gravava `tier: "premium"` direto no documento, em paralelo ao motor de
// `services/entitlement.ts` — dois escritores no mesmo campo, sem nenhum saber
// do outro. Ser fundador agora é o RAMO 2 de `calcularPlan`, e quem grava é
// `recomputeTier`, um só.
