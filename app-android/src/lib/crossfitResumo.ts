// Como um treino de CrossFit se apresenta em cada lugar.
//
// O card resume; o detalhe abre. A regra do card é dura de propósito: o WOD e o
// que mais pesou, nada além. Aquecimento e mobilidade importam para quem
// treinou, não para quem está passando o dedo no feed.

import type { Bloco, BlocoMetcon, BlocoForca, PayloadDeCrossfit } from "../api/crossfit";

export function mmss(sec?: number | null): string {
  if (sec == null) return "";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export const ROTULO_DO_BLOCO: Record<Bloco["tipo"], string> = {
  aquecimento: "Aquecimento",
  mobilidade: "Mobilidade",
  skill: "Técnica",
  forca: "Força",
  metcon: "WOD",
  descanso: "Descanso",
  cooldown: "Cooldown",
};

const ROTULO_DA_ESCALA: Record<string, string> = {
  rx: "RX",
  rx_plus: "RX+",
  scaled: "Scaled",
  iniciante: "Iniciante",
  custom: "Adaptado",
};

export function rotuloDaEscala(nivel?: string | null): string {
  return ROTULO_DA_ESCALA[nivel ?? "rx"] ?? "RX";
}

export function metconDe(wod?: PayloadDeCrossfit | null): BlocoMetcon | null {
  return (wod?.blocos.find((b) => b.tipo === "metcon") as BlocoMetcon | undefined) ?? null;
}

export function forcasDe(wod?: PayloadDeCrossfit | null): BlocoForca[] {
  return (wod?.blocos.filter((b) => b.tipo === "forca") as BlocoForca[]) ?? [];
}

/** "11:42", "7 + 12", "4 + 12 (cap)" — o resultado em uma linha. */
export function resultadoEmTexto(metcon?: BlocoMetcon | null): string {
  const r = metcon?.resultado;
  if (!r) return "";
  if (r.capado) return `${r.rounds ?? 0} + ${r.repsExtras ?? 0} (cap)`;
  switch (r.tipo) {
    case "tempo":
      return mmss(r.tempoSec);
    case "rounds_reps":
      return `${r.rounds ?? 0} + ${r.repsExtras ?? 0}`;
    case "reps":
      return `${r.reps ?? 0} reps`;
    case "carga":
      return `${r.cargaKg ?? 0} kg`;
    case "distancia":
      return `${r.distanciaM ?? 0} m`;
    default:
      return "";
  }
}

/** Como o formato se chama para quem lê: "AMRAP 12'", "5 Rounds For Time". */
export function prescricaoEmTexto(metcon?: BlocoMetcon | null): string {
  if (!metcon) return "";
  const p = metcon.prescricao;
  switch (metcon.formato) {
    case "amrap":
      return p.duracaoSec ? `AMRAP ${Math.round(p.duracaoSec / 60)}'` : "AMRAP";
    case "rft":
      return p.rounds ? `${p.rounds} Rounds For Time` : "Rounds For Time";
    case "emom":
      return p.duracaoSec
        ? `${p.intervaloSec && p.intervaloSec !== 60 ? `E${Math.round(p.intervaloSec / 60)}MOM` : "EMOM"} ${Math.round(p.duracaoSec / 60)}'`
        : "EMOM";
    case "tabata":
      return "Tabata";
    case "for_time":
      return "For Time";
    case "max_reps":
      return "Max Reps";
    case "max_load":
      return "Carga máxima";
    case "intervalo":
      return p.intervaloSec ? `A cada ${mmss(p.intervaloSec)}` : "Intervalos";
    default:
      return metcon.formatoLivre ?? "";
  }
}

/** O maior peso levantado no treino, para o card mostrar o que pesou. */
export function destaqueDeForca(wod?: PayloadDeCrossfit | null): string {
  let melhor: { nome: string; kg: number } | null = null;
  for (const bloco of forcasDe(wod)) {
    for (const ex of bloco.exercicios) {
      const kg = Math.max(0, ...ex.sets.map((s) => s.weightKg ?? 0));
      if (kg > 0 && (!melhor || kg > melhor.kg)) melhor = { nome: ex.name, kg };
    }
  }
  return melhor ? `${melhor.nome} · ${melhor.kg} kg` : "";
}

/**
 * As duas ou três linhas do card.
 *
 * Deliberadamente curto: o WOD com o resultado, a força que mais pesou, e o
 * esforço. Quem quiser o aquecimento abre o treino.
 */
export function linhasDoCard(
  wod: PayloadDeCrossfit | null | undefined,
  rpe?: number | null
): string[] {
  const metcon = metconDe(wod);
  const linhas: string[] = [];

  if (metcon) {
    const titulo = metcon.nome?.trim() || prescricaoEmTexto(metcon);
    const resultado = resultadoEmTexto(metcon);
    const escala = rotuloDaEscala(metcon.escala?.nivel);
    linhas.push([titulo, resultado, escala].filter(Boolean).join(" · "));
  }

  const forca = destaqueDeForca(wod);
  if (forca) linhas.push(forca);

  if (rpe) linhas.push(`RPE ${rpe}`);

  return linhas.filter(Boolean);
}

/** Texto sugerido ao compartilhar no feed — editável antes de publicar. */
export function legendaSugerida(
  wod: PayloadDeCrossfit | null | undefined,
  rpe?: number | null,
  temPR = false
): string {
  const partes = ["🏋️ Treino de CrossFit", ...linhasDoCard(wod, rpe)];
  if (temPR) partes.push("🔥 Novo PR");
  return partes.join("\n");
}
