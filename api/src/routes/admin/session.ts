import { Router } from "express";
import { z } from "zod";
import { User, verifyPassword } from "../../models/User.js";
import { signToken } from "../../utils/token.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { HttpError } from "../../utils/httpError.js";
import { rateLimit } from "../../middleware/rateLimit.js";
import { recordAudit, maskEmail } from "../../services/adminAudit.js";
import { env } from "../../config/env.js";

export const adminSessionRouter = Router();

const loginSchema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(1, "Senha obrigatória"),
});

/** Sessão do painel: mesma credencial do app, token de escopo e validade
 *  diferentes. Curto de propósito — quem opera o painel apaga contas. */
adminSessionRouter.post(
  "/",
  rateLimit({ windowMs: 60_000, max: 5, name: "admin-session" }),
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await User.findOne({ email });

    const senhaOk = user ? await verifyPassword(password, user.passwordHash) : false;

    // Mesma resposta para senha errada e para "não é admin": dizer qual dos
    // dois falhou entrega ao atacante a lista de quem administra o sistema.
    if (!user || !senhaOk || user.role !== "admin") {
      if (user && senhaOk) {
        await recordAudit({
          actor: null,
          action: "admin.session.negada",
          targetKind: "user",
          targetId: user._id,
          targetLabel: maskEmail(user.email),
          reason: "credencial válida, mas sem papel de admin",
        });
      }
      throw new HttpError(401, "Credenciais inválidas");
    }

    const token = signToken(user._id.toString(), {
      scope: "admin",
      expiresIn: env.adminSessionExpiresIn,
    });

    await recordAudit({
      actor: user,
      action: "admin.session",
      targetKind: "system",
    });

    res.json({
      data: {
        token,
        user: { id: user._id.toString(), name: user.name, role: user.role },
      },
      meta: { expiresIn: env.adminSessionExpiresIn },
    });
  })
);
