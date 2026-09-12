import type { StrengthPayload, ActivityCreateInput } from "../models/Activity.js";
import { resolveMuscle, isMuscleGroup, type MuscleGroup } from "./muscleGroups.js";
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
  /** Séries válidas por grupo muscular — alimenta o card e o alerta de
   *  desequilíbrio do coach (docs/ESPORTES.md §4.3). */
  seriesPorGrupo: Partial<Record<MuscleGroup, number>>;
  /** Os grupos do treino, do mais trabalhado para o menos. */
  musculos: MuscleGroup[];
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
      return {
        volumeTotalKg: m.volumeTotalKg,
        seriesValidas: m.seriesValidas,
        seriesPorGrupo: m.seriesPorGrupo,
        musculos: m.musculos,
      };
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

  const seriesPorGrupo: Partial<Record<MuscleGroup, number>> = {};
  const volumePorGrupo: Partial<Record<MuscleGroup, number>> = {};

  // `?? []` e `Array.isArray`: esta função também é chamada na LEITURA, com o
  // payload cru do Mongo (o campo é `Mixed`), que não passou pelo zod de hoje.
  for (const exercise of Array.isArray(payload?.exercises) ? payload.exercises : []) {
    if (!exercise) continue;
    // Um exercício resolve para um grupo uma vez, não a cada série.
    const grupo = resolveMuscle(exercise);

    for (const set of Array.isArray(exercise.sets) ? exercise.sets : []) {
      if (set.type !== "valida") continue;
      seriesValidas += 1;
      const volume = (set.weightKg ?? 0) * (set.reps ?? 0);
      volumeTotalKg += volume;

      // Exercício que não resolve fica de fora da conta por grupo, mas continua
      // no volume total: a pessoa levantou aquilo, só não se sabe com o quê.
      if (!grupo) continue;
      seriesPorGrupo[grupo] = (seriesPorGrupo[grupo] ?? 0) + 1;
      volumePorGrupo[grupo] = (volumePorGrupo[grupo] ?? 0) + volume;
    }
  }

  // Do mais trabalhado para o menos: séries primeiro, porque é o que define o
  // foco do dia; volume desempata; o nome desempata o desempate, para a mesma
  // entrada dar sempre a mesma ordem.
  const musculos = (Object.keys(seriesPorGrupo) as MuscleGroup[]).sort((a, b) => {
    const porSerie = (seriesPorGrupo[b] ?? 0) - (seriesPorGrupo[a] ?? 0);
    if (porSerie !== 0) return porSerie;
    const porVolume = (volumePorGrupo[b] ?? 0) - (volumePorGrupo[a] ?? 0);
    if (porVolume !== 0) return porVolume;
    return a.localeCompare(b, "pt-BR");
  });

  return { volumeTotalKg, seriesValidas, seriesPorGrupo, musculos };
}

/**
 * Os músculos de um treino de força já gravado.
 *
 * Prefere o que foi calculado no save. Cai no payload para os treinos gravados
 * antes de o campo existir — assim o feed e o perfil não esperam o backfill.
 *
 * Os dois caminhos passam pela MESMA ordenação de `computeStrengthMetrics`, de
 * propósito: se o fallback ordenasse diferente, um treino antigo e um novo
 * apareceriam com os músculos em ordens distintas no mesmo feed — e rodar o
 * backfill mudaria o título de posts que já estavam publicados, sem ninguém ter
 * editado nada.
 */
export function musculosDoTreinoSalvo(a: {
  metrics?: { musculos?: unknown } | null;
  payload?: unknown;
}): MuscleGroup[] {
  // Filtra ANTES de decidir: uma lista gravada só com valor fora do vocabulário
  // (rename futuro, dado de teste) não pode virar "sei que não é nada" e cortar
  // o fallback — o payload ainda sabe responder.
  const salvos = Array.isArray(a.metrics?.musculos)
    ? a.metrics.musculos.filter(isMuscleGroup)
    : [];
  if (salvos.length) return salvos;

  return computeStrengthMetrics(a.payload as StrengthPayload).musculos;
}
