import { Router } from "express";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { User, publicUser } from "../models/User.js";

export const billingRouter = Router();

// Tipos de evento do RevenueCat que indicam assinatura ATIVA vs perdida.
const ACTIVE_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
]);
const INACTIVE_EVENTS = new Set(["EXPIRATION", "BILLING_ISSUE"]);

/**
 * Webhook do RevenueCat. Configure o RevenueCat para usar o _id do usuário como
 * app_user_id; aqui atualizamos o tier conforme o evento. Este é o ponto de
 * integração real da assinatura.
 */
billingRouter.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    // Se um segredo estiver configurado, exige-o no header Authorization.
    if (env.revenuecatWebhookAuth) {
      if (req.headers.authorization !== env.revenuecatWebhookAuth) {
        throw new HttpError(401, "Webhook não autorizado");
      }
    }

    const event = req.body?.event ?? {};
    const appUserId: string | undefined = event.app_user_id;
    const type: string | undefined = event.type;

    if (appUserId && mongoose.isValidObjectId(appUserId) && type) {
      let tier: "free" | "premium" | null = null;
      if (ACTIVE_EVENTS.has(type)) tier = "premium";
      else if (INACTIVE_EVENTS.has(type)) tier = "free";

      if (tier) {
        await User.updateOne({ _id: appUserId }, { tier });
      }
    }

    // Webhooks devem receber 200 para não sofrerem re-tentativas.
    res.json({ received: true });
  })
);

/**
 * Upgrade de DESENVOLVIMENTO: promove o usuário a premium sem passar pela loja.
 * Serve para testar o fluxo freemium ponta a ponta. Bloqueado em produção.
 */
billingRouter.post(
  "/dev-upgrade",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (env.isProd) {
      throw new HttpError(403, "Indisponível em produção");
    }
    const user = req.user!;
    user.tier = user.tier === "premium" ? "free" : "premium"; // alterna (facilita testes)
    await user.save();
    res.json({ user: publicUser(user) });
  })
);
