import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { PersonalRecord } from "../models/PersonalRecord.js";

export const prsRouter = Router();
prsRouter.use(requireAuth);

// Lista os recordes pessoais do usuário (o app agrupa por exercício).
prsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const prs = await PersonalRecord.find({ user: req.user!._id }).sort({ exerciseName: 1, type: 1 });
    res.json({
      data: prs.map((p) => ({
        id: p._id.toString(),
        sportId: p.sportId,
        exerciseName: p.exerciseName,
        type: p.type,
        repRange: p.repRange ?? null,
        value: p.value,
        unit: p.unit,
        achievedAt: p.achievedAt,
        previousValue: p.previousValue ?? null,
        previousAchievedAt: p.previousAchievedAt ?? null,
      })),
    });
  })
);
