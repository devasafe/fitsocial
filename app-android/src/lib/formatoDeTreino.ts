// Como um treino se escreve em número e em nome.
//
// Estas quatro funções estavam copiadas entre `TreinoCard`, `CreatePostScreen`
// e a tela de treino concluído. Cópia de formatação é o tipo de duplicação que
// não dá erro: ela diverge em silêncio, e aí o mesmo treino se apresenta de um
// jeito no cartão e de outro na confirmação — que é exatamente o que o usuário
// lê como "o app está confuso".

import { sportLabel } from "./sportLabel";
import { tituloPorMusculos, musculosDe } from "./musculos";
import type { ActivityMetrics } from "../api/activities";

/**
 * Duração legível.
 *
 * O arredondamento é sobre o TOTAL de minutos, e não sobre o resto da divisão
 * por hora: a versão antiga fazia `Math.round((seg % 3600) / 60)` e escrevia
 * "1h 60min" para 1h59m50s — e "60min" para 59m55s.
 */
export function duracao(seg: number): string {
  const totalMin = Math.round(seg / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

/** Número com separador de milhar em português. */
export function numero(n: number, casas = 0): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** Ritmo de corrida, em minutos por quilômetro. */
export function ritmo(segPorKm: number): string {
  const m = Math.floor(segPorKm / 60);
  const s = Math.round(segPorKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

/** O mínimo que dá para chamar de treino, para efeito de nome. */
export interface TreinoNomeavel {
  sportId: string;
  kind: string;
  title?: string;
  metrics?: ActivityMetrics | null;
  payload?: unknown;
}

/**
 * Como o treino se chama.
 *
 * A ordem importa e é a mesma em todo lugar: o nome que a pessoa escreveu ganha
 * de qualquer resumo que o app saiba montar. "Escalada indoor" e "Fran" vivem
 * dentro do payload — sem olhar lá, quem registra em CrossFit ou em "Outro"
 * recebe uma confirmação que não menciona o que ela acabou de escrever.
 */
export function tituloDoTreino(a: TreinoNomeavel): string {
  const pl = (a.payload ?? {}) as { name?: string; activityName?: string };
  if (a.kind === "wod" && pl.name?.trim()) return pl.name.trim();
  if (a.kind === "generic" && pl.activityName?.trim()) return pl.activityName.trim();
  if (a.kind === "strength") {
    const musculos = tituloPorMusculos(musculosDe(a.metrics));
    if (musculos) return musculos;
  }
  return a.title?.trim() || sportLabel(a.sportId);
}
