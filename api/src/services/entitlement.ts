import { User, type UserDoc } from "../models/User.js";
import { isFounder } from "./founders.js";
import { recordAudit, maskEmail } from "./adminAudit.js";
import { HttpError } from "../utils/httpError.js";

export type Plano = "free" | "pro" | "pro_plus";
export type Capacidade = "coach" | "nutri";

/**
 * O plano gravado na conta, tolerando quem ainda não tem o campo.
 *
 * Contas criadas antes do RUMO Pro não têm `plan`, só `tier`. Derivar daí é o
 * que impede o deploy de rebaixar, em silêncio, todo mundo que já paga — a
 * escada nova nasceu AO LADO de `tier`, não no lugar dele, porque o APK
 * instalado lê `tier` e compara com "premium".
 */
export function planDoUsuario(user: UserDoc): Plano {
  if (user.plan) return user.plan as Plano;
  return user.tier === "premium" ? "pro" : "free";
}

/** `tier` é derivado: qualquer plano pago é "premium" para quem lê de fora. */
export function tierDoPlan(plan: Plano): "free" | "premium" {
  return plan === "free" ? "free" : "premium";
}

/**
 * Diz em que plano a pessoa está AGORA e por quê.
 *
 * Existe para resolver um conflito real: `tier` era um campo solto, então uma
 * cortesia dada pelo painel seria derrubada em silêncio pelo próximo evento de
 * expiração vindo da loja. Agora a origem manda na precedência.
 */
export function calcularPlan(user: UserDoc, agora = new Date()): Plano {
  const noDocumento = planDoUsuario(user);
  const dentroDoPrazo = !user.premiumUntil || user.premiumUntil.getTime() > agora.getTime();

  // 1. Cortesia do admin ganha do webhook — é o ponto todo desta camada.
  //    Cortesia vale como "pro"; "pro_plus" de cortesia só se estiver gravado.
  if (user.premiumSource === "admin" && dentroDoPrazo) {
    return noDocumento === "pro_plus" ? "pro_plus" : "pro";
  }
  // 2. Fundador: a lista vive em env e é lida ao vivo.
  if (isFounder(user.email)) return noDocumento === "free" ? "pro" : noDocumento;
  // 3. Compra de verdade.
  if (user.premiumSource === "purchase" && noDocumento !== "free" && dentroDoPrazo) {
    return noDocumento;
  }
  return "free";
}

/** Mantida porque meio projeto (e o app instalado) raciocina em free/premium. */
export function calcularTier(user: UserDoc, agora = new Date()): "free" | "premium" {
  return tierDoPlan(calcularPlan(user, agora));
}

/** Recalcula e grava plano e tier só quando mudam. Expira cortesia sem cron. */
export async function recomputeTier(user: UserDoc): Promise<void> {
  const novoPlan = calcularPlan(user);
  const novoTier = tierDoPlan(novoPlan);
  if (user.plan === novoPlan && user.tier === novoTier) return;

  user.plan = novoPlan;
  user.tier = novoTier;
  // Cortesia vencida: apaga a origem, senão continuaria "premium por cortesia"
  // num usuário free e a próxima leitura ficaria confusa.
  if (novoPlan === "free" && user.premiumSource === "admin") {
    user.premiumSource = null;
    user.premiumUntil = null;
  }
  await user.save();
}

/**
 * A pessoa pode atuar como coach/nutri agora?
 *
 * Independente de `plan` e de `role`: são três eixos separados. O coach também
 * é aluno (e pode ser aluno free), e ser admin não torna ninguém coach.
 */
export function temCapacidade(user: UserDoc, qual: Capacidade, agora = new Date()): boolean {
  const c = user.pro?.[qual];
  if (!c?.ativo) return false;
  return !c.validoAte || c.validoAte.getTime() > agora.getTime();
}

/** Quantos alunos esta pessoa pode acompanhar nesta capacidade. */
export function limiteDeAlunos(user: UserDoc, qual: Capacidade): number {
  return user.pro?.[qual]?.limiteDeAlunos ?? 10;
}

/** Libera coach/nutri pelo painel. `dias` nulo = sem prazo. */
export async function concederPro(
  ator: UserDoc,
  alvo: UserDoc,
  qual: Capacidade,
  dias: number | null,
  motivo: string,
  teto?: number
): Promise<UserDoc> {
  const antes = { [qual]: temCapacidade(alvo, qual) };

  alvo.set("pro." + qual, {
    ativo: true,
    origem: "manual",
    validoAte: dias ? new Date(Date.now() + dias * 24 * 60 * 60 * 1000) : null,
    limiteDeAlunos: teto ?? limiteDeAlunos(alvo, qual),
  });
  await alvo.save();

  await recordAudit({
    actor: ator,
    action: "pro." + qual + ".grant",
    targetKind: "user",
    targetId: alvo._id,
    targetLabel: maskEmail(alvo.email),
    reason: motivo,
    before: antes,
    after: { [qual]: true },
  });
  return alvo;
}

/**
 * Tira a capacidade. Os vínculos NÃO são apagados: eles são o histórico do
 * acompanhamento, e o aluno continua dono dos dados dele. O que some é o
 * acesso — quem perde a capacidade para de passar pelo `requirePro`.
 */
export async function revogarPro(
  ator: UserDoc,
  alvo: UserDoc,
  qual: Capacidade,
  motivo: string
): Promise<UserDoc> {
  if (!temCapacidade(alvo, qual)) {
    throw new HttpError(400, "Esta conta não tem essa capacidade ativa.");
  }
  alvo.set("pro." + qual + ".ativo", false);
  alvo.set("pro." + qual + ".origem", null);
  await alvo.save();

  await recordAudit({
    actor: ator,
    action: "pro." + qual + ".revoke",
    targetKind: "user",
    targetId: alvo._id,
    targetLabel: maskEmail(alvo.email),
    reason: motivo,
    before: { [qual]: true },
    after: { [qual]: false },
  });
  return alvo;
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
  // Cortesia entra como "pro"; quem já era "pro_plus" não é rebaixado por ela.
  if (planDoUsuario(alvo) !== "pro_plus") alvo.plan = "pro";
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
  alvo.plan = "free";
  alvo.tier = "free";
  await alvo.save();

  // Fundador continua premium pela lista de env, mesmo sem cortesia.
  const aindaPremiumPor = isFounder(alvo.email) ? "founder" : null;
  if (aindaPremiumPor) {
    alvo.plan = "pro";
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
    // A loja diz que pagou, não QUAL plano: sem informação de produto, entra
    // como "pro". Quem já estava em "pro_plus" continua onde estava.
    if (planDoUsuario(user) !== "pro_plus") user.plan = "pro";
    user.tier = "premium";
    await user.save();
    return;
  }

  // Expiração/problema de cobrança: só derruba quem é premium POR COMPRA.
  // Cortesia e fundador sobrevivem — era exatamente isso que quebrava antes.
  if (user.premiumSource === "admin" || isFounder(user.email)) return;

  user.premiumSource = null;
  user.plan = "free";
  user.tier = "free";
  await user.save();
}
