import type { StrengthPayload } from "../models/Activity.js";

export interface StrengthMetrics {
  volumeTotalKg: number;
  seriesValidas: number;
}

/**
 * Métricas desnormalizadas de uma atividade de força. Só séries do tipo "valida"
 * entram no volume (aquecimento/drop/falha ficam de fora) — ver docs/ESPORTES.md §4.3.
 * O motor de PR (1RM, DOTS, etc.) é de uma fatia posterior.
 */
export function computeStrengthMetrics(payload: StrengthPayload): StrengthMetrics {
  let volumeTotalKg = 0;
  let seriesValidas = 0;

  for (const exercise of payload.exercises) {
    for (const set of exercise.sets) {
      if (set.type !== "valida") continue;
      seriesValidas += 1;
      volumeTotalKg += (set.weightKg ?? 0) * (set.reps ?? 0);
    }
  }

  return { volumeTotalKg, seriesValidas };
}
