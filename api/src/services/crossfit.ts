import {
  wodPayloadSchema,
  type Bloco,
  type Carga,
  type FamiliaDeModo,
  type Movimento,
  type Score,
  type WodPayload,
} from "../models/crossfit.js";
import { interpretarModo } from "./crossfit/interpretarModo.js";
import { slugify } from "./slug.js";

/**
 * As leituras que o resto do sistema faz de um treino de CrossFit.
 *
 * O v2 mantinha aqui um tradutor do formato v1, porque os dois formatos
 * coexistiam no banco. Não coexistem mais: os treinos antigos foram apagados em
 * 11/09/2026, junto com a decisão de não carregar compatibilidade com o APK
 * 1.2.0. O tradutor foi embora com eles — e com ele a maior fonte de "de qual
 * formato veio isto?" do projeto.
 */

/** Converte kg/lb para quilos. O resto não tem conversão honesta. */
function paraKg(valor: number | null | undefined, unidade: Carga["unidade"]): number | null {
  if (valor == null) return null;
  if (unidade === "kg") return valor;
  if (unidade === "lb") return Math.round(valor * 0.453_592 * 10) / 10;
  // percent_1rm depende do 1RM de quem treinou; corporal, do peso. Nenhum dos
  // dois é conversível sem um dado que o quadro não tem.
  return null;
}

export function cargaEmKg(carga?: Carga | null): number | null {
  return carga ? paraKg(carga.rx, carga.unidade) : null;
}

/** Preenche os `*Kg` derivados. É o que o PR e os gráficos comparam. */
export function normalizarCarga(carga?: Carga | null): Carga | null {
  if (!carga) return null;
  return {
    ...carga,
    rxKg: paraKg(carga.rx, carga.unidade),
    rxFKg: paraKg(carga.rxF, carga.unidade),
  };
}

/**
 * Quantas repetições tem um round.
 *
 * `null` quando a conta não fecha — movimento medido em metro, caloria ou
 * tempo não entrega repetição, e escada (21-15-9) não tem round fixo. Nos dois
 * casos somar daria um número menor que a verdade, e o score sairia torto.
 */
export function repsPorRound(movimentos: Movimento[]): number | null {
  let total = 0;
  for (const m of movimentos) {
    const v = m.volume;
    if (!v) continue;
    if (Array.isArray(v.valor)) return null;
    if (v.unidade !== "reps") return null;
    total += v.valor;
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
export function fecharScore(
  score: Score,
  movimentos: Movimento[] = []
): Score & { valor: number | null; maiorMelhor: boolean } {
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
    case "customizado":
      // Por definição não é comparável com nada: a descrição diz o que o
      // número quer dizer, e só quem escreveu sabe.
      valor = null;
      break;
  }

  return { ...score, valor, maiorMelhor };
}

/** A forma canônica de um treino. Payload inválido vira treino vazio, nunca erro. */
export function normalizarWod(payload: unknown): WodPayload {
  const lido = wodPayloadSchema.safeParse(payload);
  if (lido.success) return lido.data;
  return { v: 3, nome: null, box: null, quadro: null, tamanhoDoTime: 1, parceiros: null, blocos: [] };
}

/**
 * Roda o interpretador em todo bloco e devolve o treino com `lido` preenchido.
 *
 * Chamado NO SALVAMENTO. Como `lido` é derivado do `modo`, rodar de novo em
 * cima de um treino já salvo é seguro e é justamente o que se quer quando o
 * interpretador melhorar.
 */
export function interpretarBlocos(wod: WodPayload): WodPayload {
  return {
    ...wod,
    blocos: wod.blocos.map((b) => ({ ...b, lido: interpretarModo(b.modo) })),
  };
}

// ---- Leituras que o resto do sistema faz ----------------------------------

export function blocosDaFamilia(wod: WodPayload, ...familias: FamiliaDeModo[]): Bloco[] {
  return wod.blocos.filter((b) => b.lido?.familia && familias.includes(b.lido.familia));
}

/**
 * O bloco que representa o treino.
 *
 * Antes era "o primeiro metcon", e isso dependia de um rótulo escolhido no
 * cadastro. Agora é o primeiro bloco QUE TEM RESULTADO — porque foi o que a
 * pessoa se deu ao trabalho de anotar, e é isso que faz dele o assunto.
 * Nenhum tem resultado: cai para o primeiro que não é descanso.
 */
export function blocoPrincipal(wod: WodPayload): Bloco | null {
  return (
    wod.blocos.find((b) => b.resultado) ??
    wod.blocos.find((b) => b.lido?.familia !== "descanso") ??
    null
  );
}

/** Nome normalizado de um movimento, para contar "mais executados".
 *
 *  A regra mora em `slug.ts` porque a musculacao passou a usar a mesma: se as
 *  duas divergirem, o mesmo movimento vira duas chaves conforme o esporte. */
export function chaveDoMovimento(nome: string): string {
  return slugify(nome);
}

/** Todos os movimentos do treino, de todos os blocos, sem repetir. */
export function movimentosDoTreino(wod: WodPayload): string[] {
  const vistos = new Set<string>();
  for (const bloco of wod.blocos) {
    for (const m of bloco.movimentos) vistos.add(chaveDoMovimento(m.nome));
  }
  vistos.delete("");
  return [...vistos];
}

/**
 * O volume total de um movimento, considerando o time.
 *
 * É a conta que o `escopo` existe para resolver: 40 burpees "dividido" entre
 * dois são 40 no total e 20 por cabeça; "cada" são 80. Sem isto o app conta
 * errado qualquer treino de dupla.
 */
export function volumeTotal(m: Movimento, tamanhoDoTime = 1): number | null {
  const v = m.volume;
  if (!v) return null;
  const base = Array.isArray(v.valor) ? v.valor.reduce((s, n) => s + n, 0) : v.valor;

  switch (m.escopo) {
    case "cada":
      return base * tamanhoDoTime;
    case "dividido":
    case "junto":
      // O time inteiro fez `base` uma vez só.
      return base;
    default:
      return base * tamanhoDoTime;
  }
}
