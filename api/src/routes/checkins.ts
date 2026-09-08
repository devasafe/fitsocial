import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createLogSchema } from "../models/WorkoutLog.js";
import { Activity, activityCreateSchema } from "../models/Activity.js";
import { Plan } from "../models/Plan.js";
import { createActivity } from "../services/activities.js";
import { computeStats } from "../services/adherence.js";

export const checkinsRouter = Router();
checkinsRouter.use(requireAuth);

// ---- Adaptação entre o contrato legado do check-in e o Activity(strength) ----
// O app continua enviando/recebendo o formato de "entries"; por baixo persistimos
// uma Activity de força. durationMin/distanceKm de cardio são preservados no set
// (legado de transição até o formato endurance da Fase 2b).

interface ReadSet {
  weightKg?: number;
  reps?: number | null;
  durationMin?: number | null;
  distanceKm?: number | null;
}
interface ReadExercise {
  name: string;
  sets?: ReadSet[];
}
function exercisesOf(a: InstanceType<typeof Activity>): ReadExercise[] {
  return ((a.payload as { exercises?: ReadExercise[] } | null)?.exercises ?? []);
}

function serializeLog(a: InstanceType<typeof Activity>) {
  const planLink = a.planLink as { sessionDay?: string } | undefined;
  return {
    id: a._id.toString(),
    sessionDay: planLink?.sessionDay ?? "",
    date: a.startedAt,
    entries: exercisesOf(a).map((ex) => {
      const s = ex.sets?.[0] ?? {};
      return {
        exerciseName: ex.name,
        weightKg: s.weightKg ?? 0,
        reps: s.reps ?? 0,
        durationMin: s.durationMin ?? 0,
        distanceKm: s.distanceKm ?? 0,
      };
    }),
    notes: a.notes,
  };
}

// Registra um treino concluído (opcionalmente compartilha no feed).
checkinsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createLogSchema.parse(req.body);
    const user = req.user!;

    const currentPlan = await Plan.findOne({ user: user._id }).sort({ version: -1 });

    const input = activityCreateSchema.parse({
      sportId: "musculacao",
      kind: "strength",
      planLink: { planVersion: currentPlan?.version ?? 0, sessionDay: body.sessionDay },
      payload: {
        variant: "musculacao",
        exercises: body.entries.map((e, i) => ({
          name: e.exerciseName,
          order: i,
          sets: [
            {
              weightKg: e.weightKg ?? 0,
              reps: e.reps ?? null,
              durationMin: e.durationMin ?? null,
              distanceKm: e.distanceKm ?? null,
            },
          ],
        })),
      },
      notes: body.notes ?? "",
      shareToFeed: body.shareToFeed,
      caption: body.shareToFeed
        ? body.shareText?.trim() || `Concluí o treino: ${body.sessionDay} 💪`
        : undefined,
    });

    const { activity, post } = await createActivity(user._id, input);
    res.status(201).json({
      log: serializeLog(activity),
      post: post ? { id: post._id.toString() } : null,
    });
  })
);

// Estatísticas de acompanhamento (streak, semana, total) — qualquer treino conta.
checkinsRouter.get(
  "/stats",
  asyncHandler(async (req, res) => {
    const acts = await Activity.find({ user: req.user!._id }).select("startedAt");
    res.json({ stats: computeStats(acts.map((a) => ({ date: a.startedAt }))) });
  })
);

// Histórico recente de treinos.
checkinsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const acts = await Activity.find({ user: req.user!._id }).sort({ startedAt: -1 }).limit(30);
    res.json({ logs: acts.map(serializeLog) });
  })
);

// Evolução de carga por exercício (para o gráfico). Ignora exercícios sem peso.
checkinsRouter.get(
  "/progress",
  asyncHandler(async (req, res) => {
    const acts = await Activity.find({ user: req.user!._id }).sort({ startedAt: 1 });

    const byExercise = new Map<string, { date: Date; weightKg: number }[]>();
    for (const a of acts) {
      for (const ex of exercisesOf(a)) {
        const weights = (ex.sets ?? []).map((s) => s.weightKg ?? 0).filter((w) => w > 0);
        if (weights.length === 0) continue; // pula cardio/sem peso
        const points = byExercise.get(ex.name) ?? [];
        points.push({ date: a.startedAt, weightKg: Math.max(...weights) });
        byExercise.set(ex.name, points);
      }
    }

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
    const acts = await Activity.find({ user: req.user!._id }).sort({ startedAt: 1 });

    const byExercise = new Map<string, { date: Date; durationMin: number; distanceKm: number }[]>();
    for (const a of acts) {
      for (const ex of exercisesOf(a)) {
        const s = ex.sets?.[0] ?? {};
        const durationMin = s.durationMin ?? 0;
        const distanceKm = s.distanceKm ?? 0;
        if (durationMin <= 0 && distanceKm <= 0) continue; // não é cardio
        const points = byExercise.get(ex.name) ?? [];
        points.push({ date: a.startedAt, durationMin, distanceKm });
        byExercise.set(ex.name, points);
      }
    }

    const exercises = [...byExercise.entries()]
      .map(([name, points]) => ({ name, points }))
      .sort((a, b) => b.points.length - a.points.length);

    res.json({ exercises });
  })
);
