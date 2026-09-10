import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { Report } from "../../models/Report.js";
import { Post } from "../../models/Post.js";
import { User } from "../../models/User.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { HttpError } from "../../utils/httpError.js";
import { excluirPost } from "../../services/postModeration.js";
import { recordAudit, maskEmail } from "../../services/adminAudit.js";

export const adminReportsRouter = Router();

/**
 * Fila de denúncias, agrupada por conteúdo.
 *
 * Dez pessoas denunciando o mesmo post viram um item com contador, não dez
 * itens — quem analisa decide sobre o conteúdo, não sobre cada denúncia.
 */
adminReportsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = String(req.query.status ?? "pendente");
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);

    const grupos = await Report.aggregate<{
      _id: { targetKind: string; targetId: mongoose.Types.ObjectId };
      total: number;
      motivos: string[];
      primeira: Date;
      ultima: Date;
      reportId: mongoose.Types.ObjectId;
      snapshot: { texto: string; imageUrl: string; autorLabel: string };
      targetAuthor: mongoose.Types.ObjectId | null;
    }>([
      { $match: status === "todas" ? {} : { status } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: { targetKind: "$targetKind", targetId: "$targetId" },
          total: { $sum: 1 },
          motivos: { $addToSet: "$reason" },
          primeira: { $min: "$createdAt" },
          ultima: { $max: "$createdAt" },
          reportId: { $first: "$_id" },
          snapshot: { $first: "$snapshot" },
          targetAuthor: { $first: "$targetAuthor" },
        },
      },
      { $sort: { total: -1, ultima: -1 } },
      { $limit: limit },
    ]);

    // Estado atual do conteúdo: pode ter sido apagado pelo autor no meio tempo.
    const posts = await Post.find({
      _id: { $in: grupos.filter((g) => g._id.targetKind === "post").map((g) => g._id.targetId) },
    }).select("text imageUrl deletedAt author createdAt");
    const porId = new Map(posts.map((p) => [p._id.toString(), p]));

    const autores = await User.find({
      _id: { $in: grupos.map((g) => g.targetAuthor).filter(Boolean) },
    }).select("name username status");
    const autorPorId = new Map(autores.map((u) => [u._id.toString(), u]));

    res.json({
      data: grupos.map((g) => {
        const atual = porId.get(g._id.targetId.toString());
        const autor = g.targetAuthor ? autorPorId.get(g.targetAuthor.toString()) : null;
        return {
          reportId: g.reportId.toString(),
          targetKind: g._id.targetKind,
          targetId: g._id.targetId.toString(),
          denuncias: g.total,
          motivos: g.motivos,
          primeira: g.primeira,
          ultima: g.ultima,
          // O que foi denunciado, como estava na hora.
          conteudo: g.snapshot,
          // E como está agora — some quando o autor apaga antes da análise.
          aindaNoAr: Boolean(atual && !atual.deletedAt),
          autor: autor
            ? {
                id: autor._id.toString(),
                nome: autor.name,
                username: autor.username ?? null,
                status: autor.status ?? "active",
              }
            : null,
        };
      }),
      meta: { status, agrupadoPorConteudo: true },
    });
  })
);

const decisaoSchema = z.object({
  decision: z.enum(["removido", "mantido"]),
  reason: z.string().min(3, "Explique a decisão").max(500),
});

/** Decide sobre um conteúdo denunciado: remove ou mantém. */
adminReportsRouter.post(
  "/:id/resolve",
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "Id inválido");
    const { decision, reason } = decisaoSchema.parse(req.body);

    const denuncia = await Report.findById(req.params.id);
    if (!denuncia) throw new HttpError(404, "Denúncia não encontrada");

    // A decisão é registrada ANTES da remoção. Excluir um post já fecha as
    // denúncias pendentes sobre ele (services/postModeration.ts); se a ordem
    // fosse invertida, este update não encontraria mais nada para fechar e o
    // resultado diria que zero denúncias foram resolvidas.
    const r = await Report.updateMany(
      { targetKind: denuncia.targetKind, targetId: denuncia.targetId, status: { $in: ["pendente", "analisando"] } },
      {
        $set: {
          status: decision === "removido" ? "resolvida" : "rejeitada",
          decision,
          resolvedBy: req.user!._id,
          resolvedAt: new Date(),
        },
      }
    );

    if (decision === "removido" && denuncia.targetKind === "post") {
      const post = await Post.findById(denuncia.targetId);
      // Já apagado pelo autor entre a denúncia e a análise: nada a remover.
      if (post && !post.deletedAt) {
        await excluirPost(req.user!, denuncia.targetId.toString(), { comoAdmin: true });
      }
    }

    await recordAudit({
      actor: req.user!,
      action: decision === "removido" ? "denuncia.removeu" : "denuncia.manteve",
      targetKind: denuncia.targetKind === "post" ? "post" : "user",
      targetId: denuncia.targetId,
      targetLabel: denuncia.snapshot?.autorLabel
        ? maskEmail(`${denuncia.snapshot.autorLabel}@—`)
        : "",
      reason,
    });

    res.json({ data: { decision, denunciasFechadas: r.modifiedCount ?? 0 }, meta: {} });
  })
);
