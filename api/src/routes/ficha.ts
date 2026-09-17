import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { Profile, profileDataSchema, type ProfileDoc } from "../models/Profile.js";

export const fichaRouter = Router();

/**
 * A ficha: os dados que o coach usa para montar plano (objetivo, dias por
 * semana, restrições...). Separada do onboarding de propósito — onboarding é
 * o EVENTO de preenchimento inicial (`POST /onboarding/profile`), ficha é o
 * DADO em si, que pode mudar depois. Sem isto, quem errou uma resposta ou
 * mudou de objetivo não tinha para onde voltar.
 */
function serialize(p: ProfileDoc) {
  return {
    goal: p.goal,
    sex: p.sex,
    age: p.age,
    heightCm: p.heightCm,
    weightKg: p.weightKg,
    experienceLevel: p.experienceLevel,
    daysPerWeek: p.daysPerWeek,
    sessionMinutes: p.sessionMinutes,
    dietaryRestrictions: p.dietaryRestrictions,
    injuriesConditions: p.injuriesConditions,
    notes: p.notes,
  };
}

// Edição parcial: reaproveita as MESMAS faixas do onboarding (idade, altura,
// dias 1-7...). Duas validações da mesma coisa divergem — uma acaba ficando
// desatualizada e aceitando o que a outra recusa.
const fichaPatchSchema = profileDataSchema.partial();

fichaRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const profile = await Profile.findOne({ user: req.user!._id });
    res.json({ data: profile ? serialize(profile) : null, meta: {} });
  })
);

fichaRouter.patch(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const entrada = fichaPatchSchema.parse(req.body);
    const profile = await Profile.findOneAndUpdate(
      { user: req.user!._id },
      { $set: entrada },
      { new: true }
    );
    // Sem upsert de propósito: PATCH edita uma ficha que já existe. Criar uma
    // ficha incompleta por trás de uma edição parcial deixaria buracos que o
    // gerador de plano nunca esperou (ex.: sem `goal`).
    if (!profile) {
      throw new HttpError(404, "Você ainda não tem uma ficha. Preencha o onboarding primeiro.");
    }
    res.json({ data: serialize(profile), meta: {} });
  })
);
