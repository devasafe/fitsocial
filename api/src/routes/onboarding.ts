import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Profile, profileDataSchema } from "../models/Profile.js";

export const onboardingRouter = Router();

// Cadastro da ficha por formulário (sem IA) — rápido e determinístico.
// Upsert 1-por-usuário + conclui o onboarding. O motor de plano consome esta ficha.
onboardingRouter.post(
  "/profile",
  requireAuth,
  asyncHandler(async (req, res) => {
    const profile = profileDataSchema.parse(req.body);
    const user = req.user!;
    await Profile.findOneAndUpdate(
      { user: user._id },
      { user: user._id, ...profile },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (!user.onboardingComplete) {
      user.onboardingComplete = true;
      await user.save();
    }
    res.json({ onboardingComplete: user.onboardingComplete });
  })
);
