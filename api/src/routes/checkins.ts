import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { WorkoutLog, createLogSchema } from "../models/WorkoutLog.js";
import { Plan } from "../models/Plan.js";
import { Post } from "../models/Post.js";
import { computeStats } from "../services/adherence.js";

export const checkinsRouter = Router();
checkinsRouter.use(requireAuth);

function serializeLog(log: InstanceType<typeof WorkoutLog>) {
  return {
    id: log._id.toString(),
    sessionDay: log.sessionDay,
    date: log.date,
    entries: log.entries,
    notes: log.notes,
  };
}

// Registra um treino concluído (opcionalmente compartilha no feed).
checkinsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createLogSchema.parse(req.body);
    const user = req.user!;

    const currentPlan = await Plan.findOne({ user: user._id }).sort({ version: -1 });

    const log = await WorkoutLog.create({
      user: user._id,
      planVersion: currentPlan?.version ?? 0,
      sessionDay: body.sessionDay,
      entries: body.entries,
      notes: body.notes ?? "",
    });

    let post = null;
    if (body.shareToFeed) {
      const text = body.shareText?.trim() || `Concluí o treino: ${body.sessionDay} 💪`;
      const created = await Post.create({ author: user._id, text });
      post = { id: created._id.toString() };
    }

    res.status(201).json({ log: serializeLog(log), post });
  })
);

// Estatísticas de acompanhamento (streak, semana, total).
checkinsRouter.get(
  "/stats",
  asyncHandler(async (req, res) => {
    const logs = await WorkoutLog.find({ user: req.user!._id }).select("date");
    res.json({ stats: computeStats(logs) });
  })
);

// Histórico recente de treinos.
checkinsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const logs = await WorkoutLog.find({ user: req.user!._id })
      .sort({ date: -1 })
      .limit(30);
    res.json({ logs: logs.map(serializeLog) });
  })
);

// Evolução de carga por exercício (para o gráfico). Ignora exercícios sem peso.
checkinsRouter.get(
  "/progress",
  asyncHandler(async (req, res) => {
    const logs = await WorkoutLog.find({ user: req.user!._id }).sort({ date: 1 });

    const byExercise = new Map<string, { date: Date; weightKg: number }[]>();
    for (const log of logs) {
      const day = log.date;
      for (const e of log.entries) {
        if (!e.weightKg || e.weightKg <= 0) continue; // pula cardio/sem peso
        const points = byExercise.get(e.exerciseName) ?? [];
        points.push({ date: day, weightKg: e.weightKg });
        byExercise.set(e.exerciseName, points);
      }
    }

    // Mais treinados primeiro.
    const exercises = [...byExercise.entries()]
      .map(([name, points]) => ({ name, points }))
      .sort((a, b) => b.points.length - a.points.length);

    res.json({ exercises });
  })
);

// Evolução de cardio: séries de duração/distância por exercício (pace é derivado no app).
checkinsRouter.get(
  "/cardio-progress",
  asyncHandler(async (req, res) => {
    const logs = await WorkoutLog.find({ user: req.user!._id }).sort({ date: 1 });

    const byExercise = new Map<string, { date: Date; durationMin: number; distanceKm: number }[]>();
    for (const log of logs) {
      for (const e of log.entries) {
        const durationMin = e.durationMin ?? 0;
        const distanceKm = e.distanceKm ?? 0;
        if (durationMin <= 0 && distanceKm <= 0) continue; // não é cardio
        const points = byExercise.get(e.exerciseName) ?? [];
        points.push({ date: log.date, durationMin, distanceKm });
        byExercise.set(e.exerciseName, points);
      }
    }

    const exercises = [...byExercise.entries()]
      .map(([name, points]) => ({ name, points }))
      .sort((a, b) => b.points.length - a.points.length);

    res.json({ exercises });
  })
);
