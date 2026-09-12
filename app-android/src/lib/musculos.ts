// Como os grupos musculares de um treino viram uma linha de texto.
//
// Quem RESOLVE exercício → músculo é o servidor (`api/src/services/muscleGroups.ts`),
// que tem o catálogo e as palavras-chave. O app só recebe a lista pronta em
// `metrics.musculos` e decide como escrevê-la — que é decisão de tela, não de
// domínio, e por isso mora aqui.

import type { MuscleGroup } from "../api/library";

/**
 * Três é o teto: o card é lido de passagem, e uma lista de seis grupos não é
 * mais informativa que "+3" — é só mais longa. O servidor usa o mesmo limite no
 * título do feed; os dois cards dizem a mesma coisa do mesmo treino.
 */
const MAXIMO = 3;

export function tituloPorMusculos(musculos?: readonly string[] | null): string {
  if (!Array.isArray(musculos) || !musculos.length) return "";
  const mostrados = musculos.slice(0, MAXIMO);
  const resto = musculos.length - mostrados.length;
  return mostrados.join(" · ") + (resto > 0 ? ` +${resto}` : "");
}

/** Lê `metrics.musculos` de um treino sem confiar no formato do que veio. */
export function musculosDe(metrics: unknown): MuscleGroup[] {
  const m = (metrics ?? {}) as { musculos?: unknown };
  if (!Array.isArray(m.musculos)) return [];
  return m.musculos.filter((x): x is MuscleGroup => typeof x === "string");
}

/**
 * O nome curto do grupo, para caber ao redor do radar.
 *
 * Doze rotulos em volta de um circulo de 320px nao cabem por extenso:
 * "Posterior de coxa" sozinho atravessaria a figura. Abreviar so os longos
 * mantem os demais legiveis por inteiro, que e melhor que encurtar todos.
 */
const CURTOS: Record<string, string> = {
  "Posterior de coxa": "Posterior",
  "Quadríceps": "Quadríceps",
  Panturrilha: "Panturrilha",
  "Corpo todo": "Corpo",
  "Trapézio": "Trapézio",
};

export function abreviarMusculo(grupo: string): string {
  return CURTOS[grupo] ?? grupo;
}
