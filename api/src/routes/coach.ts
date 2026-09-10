import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { CoachMessage } from "../models/CoachMessage.js";
import { Profile, profileDataSchema, type ProfileData } from "../models/Profile.js";
import { Plan, type PlanParts } from "../models/Plan.js";
import { Activity } from "../models/Activity.js";
import { FoodLog } from "../models/FoodLog.js";
import { chaveDoDia } from "../utils/dia.js";
import { computeStats } from "../services/adherence.js";
import { runCoachTurn, COACH_GREETING, type CoachContext } from "../services/ai/coach.js";
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

    // Monta o contexto do coach (ficha + plano + adesão + comida de hoje + tier).
    const [profileDoc, planDoc, activities, comidaDeHoje, history] = await Promise.all([
      Profile.findOne({ user: user._id }),
      Plan.findOne({ user: user._id }).sort({ version: -1 }),
      Activity.find({ user: user._id }).sort({ startedAt: -1 }).limit(40),
      FoodLog.find({ user: user._id, date: chaveDoDia() }),
      CoachMessage.find({ user: user._id }).sort({ createdAt: 1 }).limit(20),
    ]);

    const profile: ProfileData | null = profileDoc
      ? profileDataSchema.parse(profileDoc.toObject())
      : null;
    const plan: PlanParts | null = planDoc
      ? {
          summary: planDoc.summary,
          workout: (planDoc.workout as PlanParts["workout"]) ?? null,
          diet: (planDoc.diet as PlanParts["diet"]) ?? null,
          disclaimer: planDoc.disclaimer,
        }
      : null;

    // O que já foi comido hoje. É o que transforma "posso comer isso no
    // jantar?" numa pergunta respondível — sem isso o coach chuta.
    const hoje = comidaDeHoje.length
      ? comidaDeHoje.reduce(
          (acc, l) => ({
            kcal: acc.kcal + l.kcal,
            proteinG: acc.proteinG + l.proteinG,
            carbsG: acc.carbsG + l.carbsG,
            fatG: acc.fatG + l.fatG,
            refeicoesRegistradas: acc.refeicoesRegistradas + 1,
          }),
          { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, refeicoesRegistradas: 0 }
        )
      : null;

    const ctx: CoachContext = {
      profile,
      plan,
      stats: computeStats(activities.map((a) => ({ date: a.startedAt }))),
      tier: user.tier === "premium" ? "premium" : "free",
      hoje,
    };

    const aiHistory: AIMessage[] = history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const turn = await runCoachTurn(aiHistory, ctx, user._id.toString());

    // O reajuste NÃO acontece aqui. Fazer a segunda chamada de IA dentro desta
    // requisição obrigava a pessoa a esperar as duas em sequência — e, com o
    // prazo de cada uma, o total passava do que o app aguarda. Agora a conversa
    // responde na hora e o app dispara o ajuste em POST /plans/adjust, que já
    // existe e tem o próprio gating premium.
    let adjustPending = false;
    let dietAdjustPending = false;
    let premiumRequired = false;

    if (turn.action !== "none") {
      // Reajustar exige ter a metade correspondente. Depois que treino e dieta
      // passaram a existir um sem o outro, "reajustar o plano" de quem só tem
      // dieta geraria um treino que ninguém pediu.
      const temMetade =
        turn.action === "adjust_plan" ? Boolean(planDoc?.workout) : Boolean(planDoc?.diet);

      if (user.tier !== "premium") {
        premiumRequired = true;
      } else if (profile && temMetade) {
        if (turn.action === "adjust_plan") adjustPending = true;
        else dietAdjustPending = true;
      }
    }

    // Persiste a resposta do coach.
    await CoachMessage.create({ user: user._id, role: "assistant", content: turn.reply });

    // planAdjusted continua no corpo por compatibilidade: uma versão antiga do
    // app instalada no celular de alguém ainda lê esse campo.
    res.json({
      reply: turn.reply,
      planAdjusted: false,
      adjustPending,
      dietAdjustPending,
      premiumRequired,
    });
  })
);
