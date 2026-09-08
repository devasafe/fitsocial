import type { StrengthPayload, ActivityCreateInput } from "../models/Activity.js";

export interface StrengthMetrics {
  volumeTotalKg: number;
  seriesValidas: number;
}

/**
 * Métricas desnormalizadas por formato (Fase 2b). Motor de PR (1RM, melhor-5k,
 * DOTS…) é de uma fatia posterior.
 */
export function computeMetrics(input: ActivityCreateInput): Record<string, number> {
  const durationSec = input.durationSec ?? 0;
  switch (input.kind) {
    case "strength": {
      const m = computeStrengthMetrics(input.payload);
      return { volumeTotalKg: m.volumeTotalKg, seriesValidas: m.seriesValidas };
    }
    case "endurance": {
      const distanceKm = input.payload.distanceM / 1000;
      const avgPaceSecPerKm = distanceKm > 0 && durationSec > 0 ? durationSec / distanceKm : 0;
      const speedKmh = durationSec > 0 ? distanceKm / (durationSec / 3600) : 0;
      return { distanceKm, avgPaceSecPerKm, speedKmh };
    }
    case "class":
    case "generic":
    case "wod":
      return { minutes: Math.round(durationSec / 60) };
  }
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
