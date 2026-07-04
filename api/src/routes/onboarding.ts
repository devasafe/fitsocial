import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Profile } from "../models/Profile.js";
import {
  runOnboardingTurn,
  ONBOARDING_GREETING,
} from "../services/ai/onboarding.js";

export const onboardingRouter = Router();

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1),
      })
    )
    .min(1)
    .max(60),
});

// Mensagem de abertura do coach (o app mostra antes do usuário digitar).
onboardingRouter.get("/greeting", requireAuth, (_req, res) => {
  res.json({ greeting: ONBOARDING_GREETING });
});

// Um turno da conversa. O app mantém o histórico e o envia inteiro a cada chamada.
// Limite generoso o suficiente para uma conversa, mas que trava abuso.
const onboardingLimiter = rateLimit({ windowMs: 60_000, max: 30, name: "onboarding" });

onboardingRouter.post(
  "/message",
  requireAuth,
  onboardingLimiter,
  asyncHandler(async (req, res) => {
    const { messages } = bodySchema.parse(req.body);
    const user = req.user!;

    const turn = await runOnboardingTurn(messages);

    // Quando a ficha fica completa, persiste (1 por usuário) e libera o app.
    if (turn.complete && turn.profile) {
      await Profile.findOneAndUpdate(
        { user: user._id },
        { user: user._id, ...turn.profile },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      if (!user.onboardingComplete) {
        user.onboardingComplete = true;
        await user.save();
      }
    }

    res.json({
      reply: turn.reply,
      complete: turn.complete,
      onboardingComplete: user.onboardingComplete,
    });
  })
);
