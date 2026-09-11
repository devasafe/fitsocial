import type { StrengthPayload, ActivityCreateInput } from "../models/Activity.js";
import {
  normalizarWod,
  blocoPrincipal,
  movimentosDoTreino,
  fecharScore,
  volumeTotal,
  cargaEmKg,
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
  const metcon = blocoPrincipal(wod);

  // Volume prescrito: reps × carga, por movimento, já considerando o escopo do
  // time (é para isso que `volumeTotal` existe).
  //
  // No v2 isto vinha das séries REALIZADAS de um bloco de força, que o v3 não
  // guarda mais — prescrição e resultado passaram a ser coisas separadas, e o
  // registro série a série é outro fluxo. O número mudou de significado: era
  // "o que foi levantado", virou "o que estava no quadro".
  let volumeTotalKg = 0;
  let seriesValidas = 0;
  for (const bloco of wod.blocos) {
    for (const m of bloco.movimentos) {
      const reps = volumeTotal(m, wod.tamanhoDoTime);
      const kg = cargaEmKg(m.carga);
      const series = m.series ?? 1;
      if (reps != null && kg != null && m.volume?.unidade === "reps") {
        volumeTotalKg += reps * kg * series;
        seriesValidas += series;
      }
    }
  }

  const score = metcon?.resultado ? fecharScore(metcon.resultado, metcon.movimentos) : null;

  return {
    minutes: Math.round(durationSec / 60),
    volumeTotalKg,
    seriesValidas,
    // O que o interpretador entendeu de cada bloco. Era o `tipo` escolhido no
    // cadastro; agora é derivado do que o coach escreveu.
    blocos: wod.blocos.map((b) => b.lido?.familia ?? "livre"),
    movimentos: movimentosDoTreino(wod),
    ...(metcon
      ? {
          wod: {
            slug: metcon.benchmark?.slug ?? null,
            familia: metcon.benchmark?.familia ?? null,
            formato: metcon.lido?.familia ?? "livre",
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
