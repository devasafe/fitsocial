import { Router } from "express";
import type mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Notification } from "../models/Notification.js";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

interface Actor {
  _id: mongoose.Types.ObjectId;
  name: string;
  avatarUrl?: string;
}

// Lista as notificações recentes + contagem de não lidas.
notificationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    // Ordena por `updatedAt`: um assunto que agrupou algo novo acabou de
    // acontecer, mesmo que a linha tenha nascido ontem.
    const notifs = await Notification.find({ user: req.user!._id })
      .sort({ updatedAt: -1 })
      .limit(50)
      .populate("actor", "name avatarUrl");
    const unread = await Notification.countDocuments({ user: req.user!._id, read: false });
    res.json({
      data: notifs.map((n) => {
        const a = n.actor as unknown as Actor | null;
        return {
          id: n._id.toString(),
          type: n.type,
          text: n.text,
          read: n.read,
          createdAt: n.get("createdAt") as Date,
          /** Quando o assunto agrupou, é este o instante que importa. */
          atualizadaEm: n.get("updatedAt") as Date,
          /** Quantas pessoas estão dentro desta linha. */
          pessoas: Math.max(n.actors.length, 1),
          targetKind: n.targetKind,
          targetId: n.targetId?.toString() ?? null,
          // Nulo em aviso da moderação: a decisão é da plataforma, não de um
          // administrador com nome e rosto.
          actor: a ? { id: a._id.toString(), name: a.name, avatarUrl: a.avatarUrl ?? "" } : null,
        };
      }),
      unread,
    });
  })
);

// Marca todas como lidas.
notificationsRouter.post(
  "/read",
  asyncHandler(async (req, res) => {
    await Notification.updateMany({ user: req.user!._id, read: false }, { $set: { read: true } });
    res.json({ data: { ok: true } });
  })
);
