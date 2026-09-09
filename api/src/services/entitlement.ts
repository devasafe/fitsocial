import { User, type UserDoc } from "../models/User.js";
import { isFounder } from "./founders.js";
import { recordAudit, maskEmail } from "./adminAudit.js";
import { HttpError } from "../utils/httpError.js";

/**
 * Diz se a pessoa é premium AGORA e por quê.
 *
 * Existe para resolver um conflito real: `tier` era um campo solto, então uma
 * cortesia dada pelo painel seria derrubada em silêncio pelo próximo evento de
 * expiração vindo da loja. Agora a origem manda na precedência.
 */
export function calcularTier(user: UserDoc, agora = new Date()): "free" | "premium" {
  // 1. Cortesia do admin ganha do webhook — é o ponto todo desta camada.
  if (user.premiumSource === "admin") {
    if (!user.premiumUntil || user.premiumUntil.getTime() > agora.getTime()) return "premium";
  }
  // 2. Fundador: a lista vive em env e é lida ao vivo.
  if (isFounder(user.email)) return "premium";
  // 3. Compra de verdade.
  if (user.premiumSource === "purchase" && user.tier === "premium") {
    if (!user.premiumUntil || user.premiumUntil.getTime() > agora.getTime()) return "premium";
  }
  return "free";
}

/** Recalcula e grava `tier` só quando muda. É o que expira a cortesia sem cron. */
export async function recomputeTier(user: UserDoc): Promise<void> {
  const novo = calcularTier(user);
  if (user.tier === novo) return;

  user.tier = novo;
  // Cortesia vencida: apaga a origem, senão continuaria "premium por cortesia"
  // num usuário free e a próxima leitura ficaria confusa.
  if (novo === "free" && user.premiumSource === "admin") {
    user.premiumSource = null;
    user.premiumUntil = null;
  }
  await user.save();
}

/** Concede premium pelo painel. `dias` nulo = sem prazo. */
export async function concederPremium(
  ator: UserDoc,
  alvo: UserDoc,
  dias: number | null,
  motivo: string
): Promise<UserDoc> {
  const antes = { tier: alvo.tier };
  alvo.premiumSource = "admin";
  alvo.premiumUntil = dias ? new Date(Date.now() + dias * 24 * 60 * 60 * 1000) : null;
  alvo.tier = "premium";
  await alvo.save();

  await recordAudit({
    actor: ator, action: "premium.grant", targetKind: "user", targetId: alvo._id,
    targetLabel: maskEmail(alvo.email), reason: motivo,
    before: antes, after: { tier: "premium" },
  });
  return alvo;
}

/** Tira a cortesia. Se houver compra ativa, a pessoa continua premium. */
export async function revogarPremium(
  ator: UserDoc,
  alvo: UserDoc,
  motivo: string
): Promise<{ user: UserDoc; aindaPremiumPor: string | null }> {
  if (alvo.premiumSource !== "admin") {
    throw new HttpError(400, "Esta conta não tem cortesia para remover.");
  }
  const antes = { tier: alvo.tier };

  alvo.premiumSource = null;
  alvo.premiumUntil = null;
  alvo.tier = "free";
  await alvo.save();

  // Fundador continua premium pela lista de env, mesmo sem cortesia.
  const aindaPremiumPor = isFounder(alvo.email) ? "founder" : null;
  if (aindaPremiumPor) {
    alvo.tier = "premium";
    await alvo.save();
  }

  await recordAudit({
    actor: ator, action: "premium.revoke", targetKind: "user", targetId: alvo._id,
    targetLabel: maskEmail(alvo.email), reason: motivo,
    before: antes, after: { tier: alvo.tier },
  });
  return { user: alvo, aindaPremiumPor };
}

/** Aplica um evento da loja SEM pisar na cortesia do admin. */
export async function aplicarEventoDeCompra(userId: string, ativo: boolean): Promise<void> {
  const user = await User.findById(userId);
  if (!user) return;

  if (ativo) {
    user.premiumSource = "purchase";
    user.tier = "premium";
    await user.save();
    return;
  }

  // Expiração/problema de cobrança: só derruba quem é premium POR COMPRA.
  // Cortesia e fundador sobrevivem — era exatamente isso que quebrava antes.
  if (user.premiumSource === "admin" || isFounder(user.email)) return;

  user.premiumSource = null;
  user.tier = "free";
  await user.save();
}
