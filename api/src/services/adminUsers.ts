import mongoose from "mongoose";
import { User, type UserDoc } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";
import { recordAudit, maskEmail } from "./adminAudit.js";
import { definirVisibilidadeDoConteudo, invalidarOcultos } from "./moderation.js";

/** Estado que o painel mostra — já resolve suspensão vencida, para a lista não
 *  mentir enquanto a pessoa não tenta acessar o app. */
export function statusEfetivo(u: UserDoc): string {
  if (u.deletedAt) return "excluido";
  if (u.status === "suspended" && u.suspendedUntil && u.suspendedUntil.getTime() <= Date.now()) {
    return "active";
  }
  return u.status ?? "active";
}

/** Premium vencido conta como free, mesmo antes de alguém recalcular. */
export function tierEfetivo(u: UserDoc): "free" | "premium" {
  if (u.tier !== "premium") return "free";
  if (u.premiumUntil && u.premiumUntil.getTime() <= Date.now()) return "free";
  return "premium";
}

export function serializeUser(u: UserDoc) {
  return {
    id: u._id.toString(),
    name: u.name,
    email: u.email, // o admin precisa do e-mail para dar suporte; nunca vai para log
    username: u.username ?? null,
    avatarUrl: u.avatarUrl ?? "",
    role: u.role ?? "user",
    tier: u.tier,
    tierEfetivo: tierEfetivo(u),
    premiumSource: u.premiumSource ?? null,
    premiumUntil: u.premiumUntil ?? null,
    status: u.status ?? "active",
    statusEfetivo: statusEfetivo(u),
    statusReason: u.statusReason ?? "",
    suspendedUntil: u.suspendedUntil ?? null,
    contentVisible: u.contentVisible !== false,
    deletedAt: u.deletedAt ?? null,
    createdAt: u.get("createdAt") as Date,
  };
}

async function carregar(id: string): Promise<UserDoc> {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(400, "Id inválido");
  const alvo = await User.findById(id);
  if (!alvo) throw new HttpError(404, "Usuário não encontrado");
  return alvo;
}

/** Impede o admin de se derrubar sozinho e de mexer em outro admin. */
function assertPodeModerar(ator: UserDoc, alvo: UserDoc): void {
  if (ator._id.equals(alvo._id)) {
    throw new HttpError(400, "Você não pode aplicar esta ação na sua própria conta.");
  }
  if (alvo.role === "admin") {
    throw new HttpError(400, "Não dá para moderar outro administrador. Remova o papel primeiro, pelo script.");
  }
}

export async function banir(ator: UserDoc, id: string, motivo: string, esconderConteudo: boolean) {
  const alvo = await carregar(id);
  assertPodeModerar(ator, alvo);
  const antes = { status: alvo.status, contentVisible: alvo.contentVisible };

  alvo.status = "banned";
  alvo.statusReason = motivo;
  alvo.statusChangedAt = new Date();
  alvo.statusChangedBy = ator._id;
  alvo.suspendedUntil = null;
  if (esconderConteudo) alvo.contentVisible = false;
  await alvo.save();

  if (esconderConteudo) {
    await definirVisibilidadeDoConteudo(alvo._id, false);
    invalidarOcultos();
  }

  await recordAudit({
    actor: ator, action: "user.ban", targetKind: "user", targetId: alvo._id,
    targetLabel: maskEmail(alvo.email), reason: motivo,
    before: antes, after: { status: alvo.status, contentVisible: alvo.contentVisible },
  });
  return alvo;
}

export async function desbanir(ator: UserDoc, id: string, motivo: string) {
  const alvo = await carregar(id);
  const antes = { status: alvo.status, contentVisible: alvo.contentVisible };

  alvo.status = "active";
  alvo.statusReason = motivo;
  alvo.statusChangedAt = new Date();
  alvo.statusChangedBy = ator._id;
  alvo.suspendedUntil = null;
  alvo.contentVisible = true;
  await alvo.save();

  // Devolve exatamente os mesmos documentos: nada foi apagado.
  await definirVisibilidadeDoConteudo(alvo._id, true);
  invalidarOcultos();

  await recordAudit({
    actor: ator, action: "user.unban", targetKind: "user", targetId: alvo._id,
    targetLabel: maskEmail(alvo.email), reason: motivo,
    before: antes, after: { status: alvo.status, contentVisible: true },
  });
  return alvo;
}

export async function suspender(ator: UserDoc, id: string, ate: Date, motivo: string) {
  const alvo = await carregar(id);
  assertPodeModerar(ator, alvo);

  if (ate.getTime() <= Date.now()) {
    throw new HttpError(400, "A data de fim da suspensão precisa ser no futuro.");
  }
  const umAno = Date.now() + 365 * 24 * 60 * 60 * 1000;
  if (ate.getTime() > umAno) {
    throw new HttpError(400, "Suspensão vai até um ano. Para mais que isso, bana a conta.");
  }

  const antes = { status: alvo.status, suspendedUntil: alvo.suspendedUntil };
  alvo.status = "suspended";
  alvo.suspendedUntil = ate;
  alvo.statusReason = motivo;
  alvo.statusChangedAt = new Date();
  alvo.statusChangedBy = ator._id;
  alvo.contentVisible = false;
  await alvo.save();

  await definirVisibilidadeDoConteudo(alvo._id, false);
  invalidarOcultos();

  await recordAudit({
    actor: ator, action: "user.suspend", targetKind: "user", targetId: alvo._id,
    targetLabel: maskEmail(alvo.email), reason: motivo,
    before: antes, after: { status: "suspended", suspendedUntil: ate },
  });
  return alvo;
}

export async function definirVisibilidade(ator: UserDoc, id: string, visivel: boolean, motivo: string) {
  const alvo = await carregar(id);
  if (!visivel) assertPodeModerar(ator, alvo);
  const antes = { contentVisible: alvo.contentVisible };

  alvo.contentVisible = visivel;
  await alvo.save();
  await definirVisibilidadeDoConteudo(alvo._id, visivel);
  invalidarOcultos();

  await recordAudit({
    actor: ator, action: visivel ? "user.content.show" : "user.content.hide",
    targetKind: "user", targetId: alvo._id, targetLabel: maskEmail(alvo.email),
    reason: motivo, before: antes, after: { contentVisible: visivel },
  });
  return alvo;
}
