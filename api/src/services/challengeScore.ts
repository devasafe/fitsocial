import type mongoose from "mongoose";
import { Activity } from "../models/Activity.js";
import type { ChallengeDoc } from "../models/Challenge.js";

interface AggRow {
  _id: mongoose.Types.ObjectId;
  count: number;
  seconds: number;
  km: number;
}

/**
 * Pontuação automática (Fase 4a): agrega as atividades de cada membro dentro da
 * janela do desafio, filtrando pelos esportes permitidos, e calcula o score pelo
 * modo escolhido. Retorna userId (string) -> score, incluindo membros com 0.
 */
export async function computeScores(
  challenge: Pick<ChallengeDoc, "startAt" | "endAt" | "sportIds" | "scoreMode">,
  memberUserIds: mongoose.Types.ObjectId[]
): Promise<Map<string, number>> {
  const match: Record<string, unknown> = {
    user: { $in: memberUserIds },
    startedAt: { $gte: challenge.startAt, $lte: challenge.endAt },
  };
  if (challenge.sportIds && challenge.sportIds.length > 0) {
    match.sportId = { $in: challenge.sportIds };
  }

  const agg = await Activity.aggregate<AggRow>([
    { $match: match },
    {
      $group: {
        _id: "$user",
        count: { $sum: 1 },
        seconds: { $sum: "$durationSec" },
        km: { $sum: { $ifNull: ["$metrics.distanceKm", 0] } },
      },
    },
  ]);

  const scores = new Map<string, number>();
  for (const id of memberUserIds) scores.set(id.toString(), 0);

  for (const row of agg) {
    let score = 0;
    if (challenge.scoreMode === "checkins") score = row.count;
    else if (challenge.scoreMode === "minutes") score = Math.round(row.seconds / 60);
    else score = Math.round(row.km * 100) / 100;
    scores.set(row._id.toString(), score);
  }
  return scores;
}
