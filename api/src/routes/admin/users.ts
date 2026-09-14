import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { User } from "../../models/User.js";
import { Post } from "../../models/Post.js";
import { Activity } from "../../models/Activity.js";
import { AdminAudit } from "../../models/AdminAudit.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { HttpError } from "../../utils/httpError.js";
import { encodeCursorCriacao, decodeCursorCriacao } from "../../utils/cursor.js";
import { banir, desbanir, suspender, definirVisibilidade, serializeUser } from "../../services/adminUsers.js";
import { concederPremium, concederPro, revogarPremium, revogarPro } from "../../services/entitlement.js";
import { recontarAlunosDe } from "../../services/patrocinio.js";
import { recordAudit, maskEmail } from "../../services/adminAudit.js";
import { escaparRegex } from "../../utils/escaparRegex.js";
import { cuponsDoUsuario } from "../../services/cupons.js";
import { contarTreinos, zerarTreinos } from "../../services/zerarTreinos.js";
import { emReais } from "../../services/pagamentos/catalogo.js";

export const adminUsersRouter = Router();

// Motivo é obrigatório em toda ação: é o que a auditoria guarda, e daqui a seis
// meses "por que essa conta foi banida?" precisa ter resposta.
const motivoSchema = z.string().min(3, "Explique o motivo").max(500);

function assertId(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(400, "Id inválido");
}

async function carregar(id: string) {
  assertId(id);
  const u = await User.findById(id);
  if (!u) throw new HttpError(404, "Usuário não encontrado");
  return u;
}

/** Lista paginada por cursor (nunca offset — convenção do projeto). */
adminUsersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const cursor = req.query.cursor ? decodeCursorCriacao(String(req.query.cursor)) : null;
    const busca = String(req.query.q ?? "").trim();
    const status = String(req.query.status ?? "").trim();
    const tier = String(req.query.tier ?? "").trim();

    const filtro: mongoose.FilterQuery<typeof User> = {};
    if (busca) {
      const re = new RegExp(escaparRegex(busca), "i");
      filtro.$or = [{ name: re }, { email: re }, { username: re }];
    }
    if (status) filtro.status = status;
    if (tier) filtro.tier = tier;
    if (cursor) {
      filtro.$and = [
        {
          $or: [
            { createdAt: { $lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, _id: { $lt: new mongoose.Types.ObjectId(cursor.id) } },
          ],
        },
      ];
    }

    const docs = await User.find(filtro).sort({ createdAt: -1, _id: -1 }).limit(limit + 1);
    const temMais = docs.length > limit;
    const itens = temMais ? docs.slice(0, limit) : docs;
    const ultimo = itens[itens.length - 1];
    const nextCursor =
      temMais && ultimo
        ? encodeCursorCriacao({ createdAt: ultimo.get("createdAt") as Date, id: ultimo._id.toString() })
        : null;

    const total = await User.countDocuments(busca || status || tier ? filtro : {});

    res.json({ data: itens.map(serializeUser), meta: { nextCursor, total } });
  })
);

/** Detalhe SEM a ficha de saúde — Profile só sai pela rota própria, com motivo. */
adminUsersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const u = await carregar(req.params.id);
    const [posts, atividades, auditoria, cupons, treinos] = await Promise.all([
      Post.countDocuments({ author: u._id, deletedAt: null }),
      Activity.countDocuments({ user: u._id }),
      AdminAudit.find({ targetId: u._id }).sort({ createdAt: -1 }).limit(20),
      cuponsDoUsuario(u._id),
      // O tamanho do historico de treino, para o painel poder dizer "vai
      // apagar 47 treinos" antes de apagar. "Tem certeza?" nao e informacao.
      contarTreinos(u._id),
    ]);

    res.json({
      data: {
        user: serializeUser(u),
        contagens: { posts, atividades },
        /** O que um "zerar treinos" apagaria. */
        treinos,
        // O histórico de cupons desta pessoa: por onde ela chegou, o que usou
        // ao comprar, e quanto cada um rendeu. É o que responde, no suporte,
        // "essa pessoa veio de qual parceria?".
        cupons: cupons.map((c) => ({
          ...c,
          totalPagoFormatado: emReais(c.totalPagoCentavos),
          comissaoFormatada: emReais(c.comissaoCentavos),
        })),
        auditoria: auditoria.map((a) => ({
          acao: a.action,
          motivo: a.reason,
          quando: a.get("createdAt") as Date,
          por: a.actorLabel,
        })),
      },
      meta: {},
    });
  })
);

/**
 * Zera o histórico de treino de uma pessoa.
 *
 * A ÚNICA exclusão em massa do painel. O escopo é fixo no código — não há
 * filtro que quem usa possa escrever, então não há filtro que possa estar
 * errado. O único parâmetro é de quem.
 *
 * Pede o E-MAIL digitado, e não um "tem certeza?". Confirmação que se aceita
 * sem ler não confirma nada; digitar o e-mail obriga a olhar de quem é a
 * conta, que é justamente o erro a evitar.
 */
adminUsersRouter.post(
  "/:id/zerar-treinos",
  asyncHandler(async (req, res) => {
    const { reason, confirmacao } = z
      .object({ reason: motivoSchema, confirmacao: z.string() })
      .parse(req.body);

    const alvo = await carregar(req.params.id);
    if (confirmacao.trim().toLowerCase() !== alvo.email.toLowerCase()) {
      throw new HttpError(400, "O e-mail digitado não é o desta conta.");
    }

    const resumo = await zerarTreinos(req.user!, alvo, reason);
    res.json({ data: resumo, meta: {} });
  })
);

const banSchema = z.object({ reason: motivoSchema, hideContent: z.boolean().default(true) });

adminUsersRouter.post(
  "/:id/ban",
  asyncHandler(async (req, res) => {
    const { reason, hideContent } = banSchema.parse(req.body);
    const alvo = await banir(req.user!, req.params.id, reason, hideContent);
    res.json({ data: serializeUser(alvo), meta: {} });
  })
);

adminUsersRouter.post(
  "/:id/unban",
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: motivoSchema }).parse(req.body);
    const alvo = await desbanir(req.user!, req.params.id, reason);
    res.json({ data: serializeUser(alvo), meta: {} });
  })
);

const suspendSchema = z.object({
  until: z.string().datetime({ message: "Use uma data ISO" }),
  reason: motivoSchema,
});

adminUsersRouter.post(
  "/:id/suspend",
  asyncHandler(async (req, res) => {
    const { until, reason } = suspendSchema.parse(req.body);
    const alvo = await suspender(req.user!, req.params.id, new Date(until), reason);
    res.json({ data: serializeUser(alvo), meta: {} });
  })
);

const visibilidadeSchema = z.object({ visible: z.boolean(), reason: motivoSchema });

adminUsersRouter.post(
  "/:id/content-visibility",
  asyncHandler(async (req, res) => {
    const { visible, reason } = visibilidadeSchema.parse(req.body);
    const alvo = await definirVisibilidade(req.user!, req.params.id, visible, reason);
    res.json({ data: serializeUser(alvo), meta: {} });
  })
);

const premiumSchema = z.object({
  grant: z.boolean(),
  durationDays: z.number().int().positive().max(3650).nullable().default(null),
  reason: motivoSchema,
});

adminUsersRouter.post(
  "/:id/premium",
  asyncHandler(async (req, res) => {
    const { grant, durationDays, reason } = premiumSchema.parse(req.body);
    const alvo = await carregar(req.params.id);

    if (grant) {
      await concederPremium(req.user!, alvo, durationDays, reason);
      res.json({ data: serializeUser(alvo), meta: {} });
      return;
    }

    const r = await revogarPremium(req.user!, alvo, reason);
    res.json({ data: serializeUser(r.user), meta: { aindaPremiumPor: r.aindaPremiumPor } });
  })
);

const proSchema = z.object({
  capacidade: z.enum(["coach", "nutri"]),
  grant: z.boolean(),
  durationDays: z.number().int().positive().max(3650).nullable().default(null),
  /** Teto de alunos. Ausente mantém o que a conta já tinha. */
  limite: z.number().int().min(1).max(500).optional(),
  reason: motivoSchema,
});

/**
 * Libera ou tira o acesso profissional (coach/nutri).
 *
 * Existe ao lado do `scripts/grantPro.ts` porque o script é como o PRIMEIRO
 * profissional entra — antes de haver tela — e continua servindo para
 * emergência. O dia a dia é aqui: liberar alguém não pode depender de acesso
 * ao terminal do container.
 *
 * Não é escalada de privilégio, diferente de `role`: quem recebe ganha a
 * possibilidade de convidar alunos, e cada aluno ainda precisa aceitar.
 */
adminUsersRouter.post(
  "/:id/pro",
  asyncHandler(async (req, res) => {
    const { capacidade, grant, durationDays, limite, reason } = proSchema.parse(req.body);
    const alvo = await carregar(req.params.id);

    try {
      if (grant) {
        await concederPro(req.user!, alvo, capacidade, durationDays, reason, limite);
      } else {
        // Tirar a capacidade NÃO encerra vínculo (é decisão de `revogarPro`, e
        // está certa: os alunos não fizeram nada). Mas eles param de ganhar Pro
        // de graça — senão um coach revogado continuaria bancando trinta contas.
        await revogarPro(req.user!, alvo, capacidade, reason);
      }
    } finally {
      // Recontar roda MESMO quando a concessão falha.
      //
      // `revogarPro` recusa (400) uma capacidade que já está inativa — inclusive
      // a que venceu sozinha. Sem o `finally`, revogar um coach vencido
      // estourava antes da recontagem, e o admin não tinha como desfazer o
      // patrocínio nem de propósito: a única saída era conceder e revogar de
      // novo. Recontar é idempotente, então rodar sempre não custa nada.
      await recontarAlunosDe(alvo._id, capacidade);
    }
    res.json({ data: serializeUser(alvo), meta: {} });
  })
);

/** Ficha de saúde: fechada por padrão. Ver exige motivo e fica registrado. */
adminUsersRouter.get(
  "/:id/profile",
  asyncHandler(async (req, res) => {
    const motivo = motivoSchema.parse(String(req.query.reason ?? ""));
    const alvo = await carregar(req.params.id);

    const { Profile } = await import("../../models/Profile.js");
    const ficha = await Profile.findOne({ user: alvo._id });

    await recordAudit({
      actor: req.user!,
      action: "user.profile.view",
      targetKind: "user",
      targetId: alvo._id,
      targetLabel: maskEmail(alvo.email),
      reason: motivo,
    });

    // A ficha em si NUNCA entra na auditoria — só o fato de alguém ter olhado.
    res.json({ data: ficha ? ficha.toObject() : null, meta: { registrado: true } });
  })
);
