import type mongoose from "mongoose";
import { Activity, type ActivityCreateInput } from "../models/Activity.js";
import { Post } from "../models/Post.js";
import { getSport } from "./sports.js";
import { computeMetrics } from "./activityMetrics.js";
import { detectStrengthPRs, type NewPR } from "./prEngine.js";

export interface CreatedActivity {
  activity: InstanceType<typeof Activity>;
  post: InstanceType<typeof Post> | null;
  newPRs: NewPR[];
}

/**
 * Cria uma atividade (Fase 2a: kind "strength"), calcula as métricas e,
 * opcionalmente, compartilha no feed criando um Post que a referencia.
 * Reutilizado pelo cutover do check-in.
 */
export async function createActivity(
  userId: mongoose.Types.ObjectId,
  input: ActivityCreateInput
): Promise<CreatedActivity> {
  const metrics = computeMetrics(input);

  const activity = await Activity.create({
    user: userId,
    sportId: input.sportId,
    kind: input.kind,
    title: input.title ?? "",
    startedAt: input.startedAt ?? new Date(),
    durationSec: input.durationSec ?? 0,
    visibility: input.visibility,
    perceivedEffort: input.perceivedEffort,
    feeling: input.feeling,
    notes: input.notes ?? "",
    planLink: input.planLink,
    payload: input.payload,
    metrics,
  });

  // Detecção de PR (Fase 2c) — só força, síncrona.
  const newPRs =
    input.kind === "strength"
      ? await detectStrengthPRs(userId, {
          _id: activity._id,
          sportId: activity.sportId,
          startedAt: activity.startedAt,
          payload: activity.payload,
        })
      : [];

  let post: InstanceType<typeof Post> | null = null;
  if (input.shareToFeed) {
    const sport = getSport(input.sportId);
    const text = input.caption?.trim() || `Treino de ${sport?.label ?? input.sportId} concluído 💪`;
    post = await Post.create({ author: userId, text, activity: activity._id });
  }

  return { activity, post, newPRs };
}
