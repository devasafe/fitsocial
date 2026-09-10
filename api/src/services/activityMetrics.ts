import type { StrengthPayload, ActivityCreateInput } from "../models/Activity.js";
import {
  normalizarWod,
  metconPrincipal,
  blocosDoTipo,
  movimentosDoTreino,
  fecharScore,
} from "./crossfit.js";

export interface StrengthMetrics {
  volumeTotalKg: number;
  seriesValidas: number;
}

/**
 * Métricas desnormalizadas por formato (Fase 2b). Motor de PR (1RM, melhor-5k,
 * DOTS…) é de uma fatia posterior.
 */
export function computeMetrics(input: ActivityCreateInput): Record<string, unknown> {
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
    case "wod":
      return computeWodMetrics(input.payload, durationSec);
    case "class":
    case "generic":
      return { minutes: Math.round(durationSec / 60) };
  }
}

/**
 * Métricas de um treino de CrossFit.
 *
 * O payload é `Mixed` porque a forma varia de verdade — mas o que as consultas
 * do futuro precisam (quais blocos, qual benchmark, qual escala, qual score,
 * quais movimentos) é promovido para cá, que já é a superfície desnormalizada
 * do projeto. É o equilíbrio entre flexibilidade e conseguir perguntar coisas.
 */
export function computeWodMetrics(payload: unknown, durationSec: number): Record<string, unknown> {
  const wod = normalizarWod(payload);
  const metcon = metconPrincipal(wod);

  // Volume vem dos blocos de força, com o MESMO cálculo da musculação: só
  // séries válidas entram.
  let volumeTotalKg = 0;
  let seriesValidas = 0;
  for (const bloco of blocosDoTipo(wod, "forca")) {
    const m = computeStrengthMetrics({ variant: "musculacao", exercises: bloco.exercicios });
    volumeTotalKg += m.volumeTotalKg;
    seriesValidas += m.seriesValidas;
  }

  const score = metcon?.resultado
    ? fecharScore(metcon.resultado, metcon.prescricao.movimentos)
    : null;

  return {
    minutes: Math.round(durationSec / 60),
    volumeTotalKg,
    seriesValidas,
    blocos: wod.blocos.map((b) => b.tipo),
    movimentos: movimentosDoTreino(wod),
    ...(metcon
      ? {
          wod: {
            slug: metcon.benchmark?.slug ?? null,
            familia: metcon.benchmark?.familia ?? null,
            formato: metcon.formato,
            escala: metcon.escala.nivel,
            scoreTipo: score?.tipo ?? null,
            scoreValor: score?.valor ?? null,
            maiorMelhor: score?.maiorMelhor ?? null,
            capado: score?.capado ?? false,
          },
        }
      : {}),
  };
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
