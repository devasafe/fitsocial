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
import { concederPremium, revogarPremium } from "../../services/entitlement.js";
import { recordAudit, maskEmail } from "../../services/adminAudit.js";

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

/** Escapa o texto da busca: sem isto, "a+" ou "(" viram regex e quebram.
 *  Mesma expressão usada em routes/social.ts:26. */
function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    const [posts, atividades, auditoria] = await Promise.all([
      Post.countDocuments({ author: u._id }),
      Activity.countDocuments({ user: u._id }),
      AdminAudit.find({ targetId: u._id }).sort({ createdAt: -1 }).limit(20),
    ]);

    res.json({
      data: {
        user: serializeUser(u),
        contagens: { posts, atividades },
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
