import type {
  Bloco,
  Carga,
  Movimento,
  Score,
  WodPayloadV2,
} from "../models/crossfit.js";
import type { WodPayloadV1 } from "../models/Activity.js";
import { resolverBenchmark } from "./benchmarks.js";

/**
 * O ponto onde os dois formatos de WOD viram um só.
 *
 * O resto do sistema — métricas, PR, cards, detalhe — conhece apenas blocos.
 * A conversão acontece na LEITURA, não numa migração: converter o banco seria
 * irreversível, e o formato antigo continua chegando dos APKs instalados.
 */

type PayloadDeWod = WodPayloadV2 | WodPayloadV1 | Record<string, unknown>;

function ehV2(p: PayloadDeWod): p is WodPayloadV2 {
  return (p as { v?: number }).v === 2;
}

/** Converte kg/lb para quilos. O resto não tem conversão honesta. */
export function cargaEmKg(carga?: Carga | null): number | null {
  if (!carga || carga.valor == null) return null;
  if (carga.unidade === "kg") return carga.valor;
  if (carga.unidade === "lb") return Math.round(carga.valor * 0.453_592 * 10) / 10;
  // percent_1rm depende do 1RM de quem treinou; corporal, do peso. Nenhum dos
  // dois vira quilo sem inventar número.
  return null;
}

/** Preenche `valorKg` onde dá, para PR e gráfico compararem sem reinterpretar. */
export function normalizarCarga(carga?: Carga | null): Carga | null {
  if (!carga) return null;
  return { ...carga, valorKg: cargaEmKg(carga) };
}

/** Quantas repetições um round completo tem, quando dá para saber. */
export function repsPorRound(movimentos: Movimento[]): number | null {
  let total = 0;
  for (const m of movimentos) {
    // Movimento medido em metro ou caloria não entrega repetição; sem ele o
    // total do round seria menor que a verdade, e o score sairia torto.
    if (m.reps == null) {
      if (m.distanciaM != null || m.calorias != null || m.duracaoSec != null) return null;
      continue;
    }
    total += m.reps;
  }
  return total > 0 ? total : null;
}

/**
 * Fecha o score: preenche `valor` e `maiorMelhor`.
 *
 * `valor` é o número que ordena um gráfico. Para AMRAP é o total de reps —
 * `rounds × repsPorRound + repsExtras` — porque comparar só `rounds` diria que
 * "6 + 40" perdeu para "7 + 0". Quando o round não tem contagem de reps (só
 * distância ou caloria), `valor` fica nulo e a comparação cai para a ordem
 * lexicográfica de (rounds, repsExtras).
 */
export function fecharScore(score: Score, movimentos: Movimento[] = []): Score & {
  valor: number | null;
  maiorMelhor: boolean;
} {
  const maiorMelhor = score.tipo !== "tempo";

  let valor: number | null = null;
  switch (score.tipo) {
    case "tempo":
      valor = score.tempoSec ?? null;
      break;
    case "rounds_reps": {
      const porRound = repsPorRound(movimentos);
      valor =
        porRound != null && score.rounds != null
          ? score.rounds * porRound + (score.repsExtras ?? 0)
          : null;
      break;
    }
    case "reps":
      valor = score.reps ?? null;
      break;
    case "carga":
      valor = score.cargaKg ?? null;
      break;
    case "distancia":
      valor = score.distanciaM ?? null;
      break;
  }

  return { ...score, valor, maiorMelhor };
}

/**
 * Converte o formato antigo em blocos.
 *
 * O `strengthBlock` do formato antigo é a prova de que o desenho pedia uma
 * lista: quando precisaram de um segundo bloco, criaram um campo especial. Aqui
 * ele volta a ser o que sempre foi — um bloco de força antes do metcon.
 */
function deV1(p: WodPayloadV1): WodPayloadV2 {
  const blocos: Bloco[] = [];

  if (p.strengthBlock) {
    blocos.push({ tipo: "forca", exercicios: p.strengthBlock.exercises, notas: null });
  }

  const movimentos: Movimento[] = (p.movements ?? []).map((m) => ({
    nome: m.name,
    reps: m.reps ?? null,
    repScheme: null,
    distanciaM: null,
    calorias: null,
    duracaoSec: m.timeSec ?? null,
    carga: m.loadKg != null ? { valor: m.loadKg, unidade: "kg", valorKg: m.loadKg } : null,
    notas: null,
  }));

  // O formato antigo guardava o resultado em quatro campos soltos; aqui eles
  // viram o score estruturado, com o tipo que corresponde ao formato.
  const resultado: Score | null =
    p.resultTimeSec != null
      ? { tipo: "tempo", tempoSec: p.resultTimeSec }
      : p.resultRounds != null
        ? { tipo: "rounds_reps", rounds: p.resultRounds, repsExtras: p.resultReps ?? 0 }
        : p.resultReps != null
          ? { tipo: "reps", reps: p.resultReps }
          : p.resultLoadKg != null
            ? { tipo: "carga", cargaKg: p.resultLoadKg }
            : null;

  // O formato antigo só tinha o nome digitado. Resolver contra o catálogo é o
  // que devolve identidade estável ao que É benchmark, sem transformar nome
  // livre ("WOD do dia") em recorde.
  const conhecido = resolverBenchmark(p.name);

  blocos.push({
    tipo: "metcon",
    nome: p.name,
    benchmark: conhecido ? { slug: conhecido.slug, familia: conhecido.familia } : null,
    // Dois renomes na conversão. "for_reps" virou "max_reps", e "chipper"
    // deixou de ser formato: chipper É um for time — o que o define é a
    // sequência de movimentos, que agora tem ordem própria na prescrição.
    formato:
      p.scoreType === "for_reps"
        ? "max_reps"
        : p.scoreType === "chipper"
          ? "for_time"
          : p.scoreType,
    formatoLivre: null,
    prescricao: { movimentos },
    resultado,
    // "adaptado" é preservado como está: é a chave dos recordes que já foram
    // gravados por quem usa o app instalado. Trocar para "custom" faria o
    // recorde antigo ficar parado ao lado de um novo começando do zero.
    escala: { nivel: p.level },
    rounds: null,
    notas: p.description ?? null,
  });

  return { v: 2, box: null, blocos };
}

/** A forma canônica de um treino de CrossFit, venha ele de onde vier. */
export function normalizarWod(payload: unknown): WodPayloadV2 {
  const p = (payload ?? {}) as PayloadDeWod;
  if (ehV2(p)) return p;
  return deV1(p as WodPayloadV1);
}

// ---- Leituras que o resto do sistema faz ----------------------------------

export function blocosDoTipo<T extends Bloco["tipo"]>(
  wod: WodPayloadV2,
  tipo: T
): Extract<Bloco, { tipo: T }>[] {
  return wod.blocos.filter((b): b is Extract<Bloco, { tipo: T }> => b.tipo === tipo);
}

/** O metcon principal: o primeiro do treino. */
export function metconPrincipal(wod: WodPayloadV2) {
  return blocosDoTipo(wod, "metcon")[0] ?? null;
}

/** Nome normalizado de um movimento, para contar "mais executados". */
export function chaveDoMovimento(nome: string): string {
  return nome
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Todos os movimentos do treino, de todos os blocos, sem repetir. */
export function movimentosDoTreino(wod: WodPayloadV2): string[] {
  const vistos = new Set<string>();
  for (const bloco of wod.blocos) {
    if (bloco.tipo === "forca") {
      for (const e of bloco.exercicios) vistos.add(chaveDoMovimento(e.name));
    } else if (bloco.tipo === "skill") {
      vistos.add(chaveDoMovimento(bloco.movimento));
    } else if (bloco.tipo === "metcon") {
      for (const m of bloco.prescricao.movimentos) vistos.add(chaveDoMovimento(m.nome));
    } else {
      for (const m of bloco.movimentos) vistos.add(chaveDoMovimento(m.nome));
    }
  }
  vistos.delete("");
  return [...vistos];
}

/**
 * A volta: blocos → os campos planos do formato antigo.
 *
 * O app instalado lê `payload.name`, `payload.level`, `payload.resultTimeSec` e
 * `payload.movements`. Um treino gravado no formato novo não tem nenhum deles,
 * e a tela de detalhe dele mostraria "WOD: —" para tudo.
 *
 * Servir os campos planos AO LADO dos blocos resolve sem tirar nada de
 * ninguém — mesma escolha do `crossfit` ao lado do `payload`.
 */
export function paraFormatoAntigo(wod: WodPayloadV2): Record<string, unknown> {
  const metcon = metconPrincipal(wod);
  if (!metcon) return {};

  const r = metcon.resultado;
  const forca = blocosDoTipo(wod, "forca")[0];

  return {
    name: metcon.nome ?? metcon.benchmark?.slug ?? "Treino",
    // "intervalo" e "outro" não existiam no formato antigo; o mais próximo que
    // ele entende é for_time.
    scoreType:
      metcon.formato === "max_reps"
        ? "for_reps"
        : metcon.formato === "intervalo" || metcon.formato === "outro"
          ? "for_time"
          : metcon.formato,
    level: metcon.escala.nivel === "rx" || metcon.escala.nivel === "scaled" ? metcon.escala.nivel : "adaptado",
    ...(r?.tipo === "tempo" && r.tempoSec != null ? { resultTimeSec: r.tempoSec } : {}),
    ...(r?.tipo === "rounds_reps" ? { resultRounds: r.rounds ?? 0, resultReps: r.repsExtras ?? 0 } : {}),
    ...(r?.tipo === "reps" && r.reps != null ? { resultReps: r.reps } : {}),
    ...(r?.tipo === "carga" && r.cargaKg != null ? { resultLoadKg: r.cargaKg } : {}),
    ...(metcon.notas ? { description: metcon.notas } : {}),
    ...(forca ? { strengthBlock: { variant: "musculacao", exercises: forca.exercicios } } : {}),
    movements: metcon.prescricao.movimentos.slice(0, 30).map((m) => ({
      name: m.nome,
      // Calcula em vez de ler `valorKg`: esse campo é derivado e o cliente não
      // é obrigado a mandá-lo preenchido.
      ...(cargaEmKg(m.carga) != null ? { loadKg: cargaEmKg(m.carga) } : {}),
      // O formato antigo só sabia reps; distância e caloria viram o número que
      // houver, para o card não ficar mudo.
      ...(m.reps != null ? { reps: m.reps } : {}),
      ...(m.duracaoSec != null ? { timeSec: m.duracaoSec } : {}),
    })),
  };
}
