import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { WaterLog, waterLogCreateSchema } from "../models/WaterLog.js";
import { Profile } from "../models/Profile.js";

export const waterRouter = Router();
waterRouter.use(requireAuth);

// Meta sugerida pelo peso (~35 ml/kg), arredondada a 50 ml e limitada.
function suggestedGoal(weightKg: number | undefined): number {
  const base = (weightKg && weightKg > 0 ? weightKg : 70) * 35;
  return Math.min(4000, Math.max(1500, Math.round(base / 50) * 50));
}

function serialize(l: InstanceType<typeof WaterLog>) {
  return { id: l._id.toString(), date: l.date, ml: l.ml, createdAt: l.get("createdAt") as Date };
}

// Resumo do dia: registros, total e a meta (custom do usuário ou sugerida).
waterRouter.get(
  "/day",
  asyncHandler(async (req, res) => {
    const date = String(req.query.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "Data inválida (use yyyy-mm-dd)");

    const logs = await WaterLog.find({ user: req.user!._id, date }).sort({ createdAt: 1 });
    const total = logs.reduce((acc, l) => acc + l.ml, 0);

    const custom = req.user!.waterGoalMl ?? 0;
    let goalMl = custom;
    if (goalMl <= 0) {
      const profile = await Profile.findOne({ user: req.user!._id }).select("weightKg");
      goalMl = suggestedGoal(profile?.weightKg);
    }
    res.json({ logs: logs.map(serialize), total, goalMl, goalIsCustom: custom > 0 });
  })
);

// Registra uma ingestão.
waterRouter.post(
  "/logs",
  asyncHandler(async (req, res) => {
    const input = waterLogCreateSchema.parse(req.body);
    const log = await WaterLog.create({ user: req.user!._id, ...input });
    res.status(201).json({ data: serialize(log) });
  })
);

// Remove um registro.
waterRouter.delete(
  "/logs/:id",
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "ID inválido");
    const r = await WaterLog.deleteOne({ _id: req.params.id, user: req.user!._id });
    if (!r.deletedCount) throw new HttpError(404, "Registro não encontrado");
    res.json({ data: { deleted: true } });
  })
);

// Define a meta diária (ml). 0 volta para a sugestão automática.
const goalSchema = z.object({ goalMl: z.number().int().min(0).max(8000) });
waterRouter.put(
  "/goal",
  asyncHandler(async (req, res) => {
    const { goalMl } = goalSchema.parse(req.body);
    const user = req.user!;
    user.waterGoalMl = goalMl;
    await user.save();
    res.json({ data: { goalMl } });
  })
);
