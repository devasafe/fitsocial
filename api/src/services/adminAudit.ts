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
const CAMPOS_PERMITIDOS = new Set([
  "role",
  "tier",
  "status",
  "suspendedUntil",
  "contentVisible",
  // Direitos e cobrança. Sem estar nesta lista, `filtrar()` descarta o campo em
  // SILÊNCIO — o diff da auditoria gravaria vazio e ninguém notaria até
  // precisar dele para explicar por que alguém perdeu ou ganhou acesso.
  "plan",
  "premiumSource",
  "assinaturaStatus",
  "produtoAssinado",
  "vinculosPatrocinados",
  // Cupom. O diff de criação e de revogação passa por aqui, e sem estes nomes
  // a auditoria de um cupom de parceria gravaria `null` — justo o registro que
  // responde "com que comissão esse cupom foi criado?" no dia em que o
  // parceiro discordar do valor.
  "codigo",
  "desconto",
  "parceiro",
  "comissao",
  "revogadoEm",
  // A cópia do documento no CRUD de coleções. É o que permite desfazer um
  // apagar, e sem ela a ferramenta não deveria existir.
  "documento",
]);

function filtrar(obj: Record<string, unknown> | null | undefined) {
  if (!obj) return null;
  const out: Record<string, unknown> = {};
  const descartados: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (CAMPOS_PERMITIDOS.has(k)) out[k] = v;
    else descartados.push(k);
  }

  // O descarte SILENCIOSO desta allowlist já custou três vezes: assinatura,
  // cupom e a cópia do documento do CRUD. Em todas, o diff da auditoria
  // gravou `null` e ninguém notou até precisar dele para explicar o que
  // aconteceu com uma conta.
  //
  // O aviso só sai fora de produção, e é de propósito: ele serve para quem
  // está escrevendo a chamada nova, no momento em que ela ainda não funciona.
  // Em produção, um campo desconhecido é ruído que já não dá para consertar.
  if (descartados.length && process.env.NODE_ENV !== "production") {
    console.warn(
      `[auditoria] campos descartados do diff (adicione a CAMPOS_PERMITIDOS): ${descartados.join(", ")}`
    );
  }

  return Object.keys(out).length ? out : null;
}

export interface AuditInput {
  actor: UserDoc | null;
  action: string;
  targetKind: "user" | "post" | "comment" | "aiKey" | "cupom" | "system";
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
