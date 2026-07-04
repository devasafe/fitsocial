import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { CoachMessage } from "../models/CoachMessage.js";
import { Profile, profileDataSchema, type ProfileData } from "../models/Profile.js";
import { Plan, type PlanData } from "../models/Plan.js";
import { WorkoutLog } from "../models/WorkoutLog.js";
import { computeStats, buildAdherenceSummary } from "../services/adherence.js";
import { runCoachTurn, COACH_GREETING, type CoachContext } from "../services/ai/coach.js";
import { adjustPlan } from "../services/ai/planGenerator.js";
import type { AIMessage } from "../services/ai/provider.js";

export const coachRouter = Router();
coachRouter.use(requireAuth);

const bodySchema = z.object({ content: z.string().min(1).max(2000) });
const coachLimiter = rateLimit({ windowMs: 60_000, max: 20, name: "coach" });

// Histórico da conversa (o app mostra a saudação quando está vazio).
coachRouter.get(
  "/messages",
  asyncHandler(async (req, res) => {
    const messages = await CoachMessage.find({ user: req.user!._id })
      .sort({ createdAt: 1 })
      .limit(100);
    res.json({
      greeting: COACH_GREETING,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
  })
);

coachRouter.post(
  "/messages",
  coachLimiter,
  asyncHandler(async (req, res) => {
    const { content } = bodySchema.parse(req.body);
    const user = req.user!;

    // Persiste a mensagem do usuário.
    await CoachMessage.create({ user: user._id, role: "user", content });

    // Monta o contexto do coach (ficha + plano + adesão + tier).
    const [profileDoc, planDoc, logs, history] = await Promise.all([
      Profile.findOne({ user: user._id }),
      Plan.findOne({ user: user._id }).sort({ version: -1 }),
      WorkoutLog.find({ user: user._id }).sort({ date: -1 }).limit(40),
      CoachMessage.find({ user: user._id }).sort({ createdAt: 1 }).limit(20),
    ]);

    const profile: ProfileData | null = profileDoc
      ? profileDataSchema.parse(profileDoc.toObject())
      : null;
    const plan: PlanData | null = planDoc
      ? {
          summary: planDoc.summary,
          workout: planDoc.workout,
          diet: planDoc.diet,
          disclaimer: planDoc.disclaimer,
        }
      : null;

    const ctx: CoachContext = {
      profile,
      plan,
      stats: computeStats(logs),
      tier: user.tier === "premium" ? "premium" : "free",
    };

    const aiHistory: AIMessage[] = history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const turn = await runCoachTurn(aiHistory, ctx);

    // Aplica a ação de reajuste (gating premium acontece aqui).
    let planAdjusted = false;
    let premiumRequired = false;
    if (turn.action === "adjust_plan") {
      if (user.tier === "premium" && profile && planDoc) {
        const adherence = buildAdherenceSummary(logs, plan!);
        const data = await adjustPlan(profile, plan!, adherence);
        await Plan.create({ user: user._id, version: planDoc.version + 1, ...data });
        planAdjusted = true;
      } else if (user.tier !== "premium") {
        premiumRequired = true;
      }
    }

    // Persiste a resposta do coach.
    await CoachMessage.create({ user: user._id, role: "assistant", content: turn.reply });

    res.json({ reply: turn.reply, planAdjusted, premiumRequired });
  })
);
