import type mongoose from "mongoose";
import { AdminAudit } from "../models/AdminAudit.js";
import type { UserDoc } from "../models/User.js";

/** Mascara o e-mail para caber no log: "asafe@gmail.com" -> "a***@gmail.com".
 *  O SECURITY.md proíbe e-mail completo em log, e auditoria é log. */
export function maskEmail(email: string): string {
  const [local, dominio] = email.split("@");
  if (!dominio) return "***";
  return `${local.slice(0, 1)}***@${dominio}`;
}

/** Campos que podem aparecer no diff. O que não estiver aqui é descartado —
 *  é decisão desta camada, não de quem chama, para nada sensível escapar. */
const CAMPOS_PERMITIDOS = new Set(["role", "tier", "status", "suspendedUntil", "contentVisible"]);

function filtrar(obj: Record<string, unknown> | null | undefined) {
  if (!obj) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (CAMPOS_PERMITIDOS.has(k)) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

export interface AuditInput {
  actor: UserDoc | null;
  action: string;
  targetKind: "user" | "post" | "comment" | "aiKey" | "system";
  targetId?: mongoose.Types.ObjectId | string | null;
  targetLabel?: string;
  reason?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/** Grava a auditoria. É aguardado de propósito: auditoria que falha em silêncio
 *  não é auditoria — se não deu para registrar, a ação não deve ser dada como
 *  feita. Diferente da telemetria de IA, que é fire-and-forget. */
export async function recordAudit(input: AuditInput): Promise<AdminAuditDocId> {
  const doc = await AdminAudit.create({
    actor: input.actor?._id ?? null,
    actorLabel: input.actor ? maskEmail(input.actor.email) : "sistema",
    action: input.action,
    targetKind: input.targetKind,
    targetId: input.targetId ?? null,
    targetLabel: input.targetLabel ?? "",
    reason: input.reason ?? "",
    before: filtrar(input.before),
    after: filtrar(input.after),
  });
  return doc._id.toString();
}

type AdminAuditDocId = string;
