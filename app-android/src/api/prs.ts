import { apiFetch } from "./client";
import type { NewPR } from "./activities";

export interface PersonalRecord {
  id: string;
  sportId: string;
  exerciseName: string;
  /** A identidade do exercicio. Vazio em recorde antigo, antes do backfill. */
  exerciseSlug?: string;
  type: "carga_max" | "rm_estimado" | "carga_faixa" | "best_dist" | "best_time" | "aulas" | "horas";
  repRange: string | null;
  value: number;
  unit: string;
  achievedAt: string;
  previousValue: number | null;
  previousAchievedAt: string | null;
}

export async function listPRs(
  token: string
): Promise<{ itens: PersonalRecord[]; limitadoPeloPlano: boolean }> {
  const res = await apiFetch<{ data: PersonalRecord[]; meta?: { limitadoPor?: string } }>("/prs", {
    token,
  });
  // O servidor devolve lista vazia e diz que limitou, em vez de recusar: sem
  // ler isto, a tela mostraria "nenhum recorde ainda" para quem tem recordes.
  return { itens: res.data, limitadoPeloPlano: res.meta?.limitadoPor === "plano" };
}

/** Rótulo do tipo de recorde. */
export function prTypeLabel(type: string, repRange: string | null): string {
  switch (type) {
    case "carga_max":
      return "Carga máxima";
    case "rm_estimado":
      return "1RM estimado";
    case "carga_faixa":
      return `Carga · ${repRange} reps`;
    case "best_dist":
      return "Maior distância";
    case "best_time":
      return `Melhor tempo · ${repRange}`;
    case "aulas":
      return "Aulas";
    case "horas":
      return "Horas de treino";
    case "wod_time":
      return `Tempo · ${repRange}`;
    case "wod_score":
      return `Score · ${repRange}`;
    case "wod_load":
      return `Carga · ${repRange}`;
    default:
      return type;
  }
}

function mmss(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.round(totalSec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Valor formatado com unidade, por tipo. */
export function prValueLabel(type: string, value: number, unit: string): string {
  switch (type) {
    case "best_dist":
      return `${Math.round((value / 1000) * 100) / 100} km`;
    case "best_time":
    case "wod_time":
      return mmss(value);
    case "aulas":
      return `${value} aulas`;
    case "horas":
      return `${value} h`;
    default:
      return `${Math.round(value * 10) / 10} ${unit}`;
  }
}

const NAMED_TYPES = new Set(["carga_max", "rm_estimado", "carga_faixa", "wod_time", "wod_score", "wod_load"]);

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Monta o texto do aviso de recorde ao salvar um treino. */
export function newPRMessage(prs: NewPR[]): { title: string; body: string } | null {
  if (!prs.length) return null;
  const lines = prs.map((p) => {
    if (p.milestone) return `${prTypeLabel(p.type, p.repRange)}: ${p.milestone} — marco!`;
    const label = NAMED_TYPES.has(p.type)
      ? `${capitalize(p.exerciseName)} (${prTypeLabel(p.type, p.repRange)})`
      : prTypeLabel(p.type, p.repRange);
    const now = prValueLabel(p.type, p.value, p.unit);
    const prev = p.previousValue != null ? ` (antes ${prValueLabel(p.type, p.previousValue, p.unit)})` : "";
    return `${label}: ${now}${prev}`;
  });
  return { title: prs.length > 1 ? "Novos recordes" : "Novo recorde", body: lines.join("\n") };
}

/**
 * A legenda sugerida quando o treino bateu recorde.
 *
 * Editavel, como a do CrossFit: o app oferece o texto que ele tem dados para
 * escrever, e quem publica decide. O recorde e o motivo de postar — deixar a
 * pessoa procurar as palavras logo depois de treinar e' o que faz a conquista
 * virar mais um post generico.
 *
 * Marco de aula/hora fica de fora: e conquista, mas nao e recorde, e a frase
 * seria "bati meu recorde em Aulas". `carga_faixa` tambem: ele e um recorde
 * DENTRO de uma faixa de repeticoes, e a legenda descartaria o `repRange` —
 * "meu recorde no Supino: 100 kg" se leria como recorde absoluto no feed.
 */
const TIPOS_DA_LEGENDA = new Set(["carga_max", "rm_estimado"]);

export function legendaDeRecorde(prs: NewPR[]): string {
  const pr = prs.find((p) => !p.milestone && TIPOS_DA_LEGENDA.has(p.type));
  if (!pr) return "";

  const valor = prValueLabel(pr.type, pr.value, pr.unit);
  return `Hoje bati meu recorde no ${capitalize(pr.exerciseName)}: ${valor} 🔥`;
}
