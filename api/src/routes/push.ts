import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { PushDevice } from "../models/PushDevice.js";

export const pushRouter = Router();
pushRouter.use(requireAuth);

const registroSchema = z.object({
  // O formato real é "ExpoPushToken[...]"; validar o prefixo evita gravar lixo,
  // sem prender o projeto a um detalhe do serviço.
  token: z.string().min(10).max(300),
  platform: z.enum(["ios", "android"]),
});

/**
 * Registra (ou reconfirma) o aparelho de quem está logado.
 *
 * `upsert` pelo token, não pelo par usuário+token: se o telefone mudou de dono,
 * o registro muda de dono junto. Sem isso, quem entrasse depois na mesma
 * máquina continuaria recebendo os avisos de quem usou antes.
 */
pushRouter.post(
  "/devices",
  asyncHandler(async (req, res) => {
    const { token, platform } = registroSchema.parse(req.body);

    await PushDevice.updateOne(
      { token },
      { $set: { user: req.user!._id, platform, lastSeenAt: new Date() } },
      { upsert: true }
    );

    res.status(201).json({ data: { registrado: true }, meta: {} });
  })
);

/** Sair da conta neste aparelho para de mandar push para ele. */
pushRouter.delete(
  "/devices",
  asyncHandler(async (req, res) => {
    const { token } = z.object({ token: z.string().min(10).max(300) }).parse(req.body);
    // Só o dono atual do registro remove: um token alheio não é assunto seu.
    const r = await PushDevice.deleteOne({ token, user: req.user!._id });
    res.json({ data: { removido: r.deletedCount > 0 }, meta: {} });
  })
);
