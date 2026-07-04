import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { Profile, profileDataSchema } from "../models/Profile.js";
import { Plan } from "../models/Plan.js";
import { generatePlan } from "../services/ai/planGenerator.js";

export const plansRouter = Router();

function serializePlan(plan: InstanceType<typeof Plan>) {
  return {
    id: plan._id.toString(),
    version: plan.version,
    summary: plan.summary,
    workout: plan.workout,
    diet: plan.diet,
    disclaimer: plan.disclaimer,
    createdAt: plan.get("createdAt") as Date,
  };
}

// Gera um novo plano a partir da ficha do usuário e o salva como nova versão.
// Geração é cara (IA); limite baixo por minuto.
const generateLimiter = rateLimit({ windowMs: 60_000, max: 5, name: "plan-generate" });

plansRouter.post(
  "/generate",
  requireAuth,
  generateLimiter,
  asyncHandler(async (req, res) => {
    const user = req.user!;

    const profileDoc = await Profile.findOne({ user: user._id });
    if (!profileDoc) {
      throw new HttpError(409, "Conclua o onboarding antes de gerar um plano");
    }

    const last = await Plan.findOne({ user: user._id }).sort({ version: -1 });

    // Gating do freemium: grátis pode gerar o 1º plano; regenerar é premium.
    if (last && user.tier !== "premium") {
      throw new HttpError(
        402,
        "Gerar um novo plano é um recurso Premium. Assine para ter planos ilimitados."
      );
    }

    // Revalida a ficha antes de mandar para a IA.
    const profile = profileDataSchema.parse(profileDoc.toObject());
    const data = await generatePlan(profile);

    const plan = await Plan.create({
      user: user._id,
      version: (last?.version ?? 0) + 1,
      ...data,
    });

    res.status(201).json({ plan: serializePlan(plan) });
  })
);

// Retorna o plano mais recente do usuário (ou 404 se ainda não gerou).
plansRouter.get(
  "/current",
  requireAuth,
  asyncHandler(async (req, res) => {
    const plan = await Plan.findOne({ user: req.user!._id }).sort({ version: -1 });
    if (!plan) {
      throw new HttpError(404, "Nenhum plano gerado ainda");
    }
    res.json({ plan: serializePlan(plan) });
  })
);
