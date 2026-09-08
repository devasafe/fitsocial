import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { FoodLog, foodLogCreateSchema } from "../models/FoodLog.js";
import { Plan } from "../models/Plan.js";

export const nutritionRouter = Router();
nutritionRouter.use(requireAuth);

function serialize(l: InstanceType<typeof FoodLog>) {
  return {
    id: l._id.toString(),
    date: l.date,
    meal: l.meal,
    name: l.name,
    kcal: l.kcal,
    proteinG: l.proteinG,
    carbsG: l.carbsG,
    fatG: l.fatG,
  };
}

// Registra um alimento no diário.
nutritionRouter.post(
  "/logs",
  asyncHandler(async (req, res) => {
    const input = foodLogCreateSchema.parse(req.body);
    const log = await FoodLog.create({ user: req.user!._id, ...input });
    res.status(201).json({ data: serialize(log) });
  })
);

// Resumo do dia: itens, totais e a meta do plano.
nutritionRouter.get(
  "/day",
  asyncHandler(async (req, res) => {
    const date = String(req.query.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "Data inválida (use yyyy-mm-dd)");

    const logs = await FoodLog.find({ user: req.user!._id, date }).sort({ createdAt: 1 });
    const totals = logs.reduce(
      (acc, l) => ({
        kcal: acc.kcal + l.kcal,
        proteinG: acc.proteinG + l.proteinG,
        carbsG: acc.carbsG + l.carbsG,
        fatG: acc.fatG + l.fatG,
      }),
      { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }
    );

    const plan = await Plan.findOne({ user: req.user!._id }).sort({ version: -1 });
    const diet = plan?.diet as
      | { dailyCalories?: number; macros?: { proteinG: number; carbsG: number; fatG: number } }
      | undefined;
    const target = diet ? { dailyCalories: diet.dailyCalories ?? 0, macros: diet.macros ?? null } : null;

    res.json({ logs: logs.map(serialize), totals, target });
  })
);

// Apaga um registro.
nutritionRouter.delete(
  "/logs/:id",
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "ID inválido");
    const r = await FoodLog.deleteOne({ _id: req.params.id, user: req.user!._id });
    if (!r.deletedCount) throw new HttpError(404, "Registro não encontrado");
    res.json({ data: { deleted: true } });
  })
);
