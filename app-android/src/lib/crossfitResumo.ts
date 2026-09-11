// Como um treino de CrossFit se apresenta em cada lugar.
//
// O card resume; o detalhe abre. A regra do card é dura de propósito: o WOD e o
// que mais pesou, nada além. Aquecimento e mobilidade importam para quem
// treinou, não para quem está passando o dedo no feed.
//
// O que mudou no v3: não existe mais "tipo de bloco" para filtrar. O bloco que
// interessa é o que TEM RESULTADO — porque foi o que a pessoa se deu ao
// trabalho de anotar, e é isso que faz dele o assunto.

import type { Bloco, PayloadDeCrossfit, Score } from "../api/crossfit";
import { resumoDoMovimento } from "../components/crossfit/MovimentosEditor";

export function mmss(sec?: number | null): string {
  if (sec == null) return "";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const ROTULO_DA_ESCALA: Record<string, string> = {
  rx: "RX",
  rx_plus: "RX+",
  scaled: "Scaled",
  iniciante: "Iniciante",
  custom: "Adaptado",
  adaptado: "Adaptado",
};

export function rotuloDaEscala(nivel?: string | null): string {
  return ROTULO_DA_ESCALA[nivel ?? "rx"] ?? "RX";
}

/** O bloco que representa o treino: o primeiro COM resultado. */
export function blocoPrincipal(wod?: PayloadDeCrossfit | null): Bloco | null {
  const blocos = wod?.blocos ?? [];
  return (
    blocos.find((b) => b.resultado) ??
    blocos.find((b) => b.lido?.familia !== "descanso") ??
    null
  );
}

export function blocosComResultado(wod?: PayloadDeCrossfit | null): Bloco[] {
  return (wod?.blocos ?? []).filter((b) => b.resultado);
}

export function ehDescanso(b: Bloco): boolean {
  return b.lido?.familia === "descanso";
}

/** "11:42", "7 + 12", "4 + 12 (cap)" — o resultado em uma linha. */
export function resultadoEmTexto(r?: Score | null): string {
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
    case "customizado":
      return r.descricao ? `${r.reps ?? 0} — ${r.descricao}` : `${r.reps ?? 0}`;
    default:
      return "";
  }
}

/**
 * O treino escrito de volta no formato do quadro.
 *
 * É o teste de aceite do briefing: se o preview não sai igual ao que o coach
 * escreveria, tem informação faltando ou mal colocada no modelo. Por isso ele
 * fica visível DURANTE o cadastro, e não só depois.
 */
export function comoNoQuadro(wod?: PayloadDeCrossfit | null): string {
  const linhas: string[] = [];

  for (const bloco of wod?.blocos ?? []) {
    const cabecalho = [bloco.nome, bloco.modo].filter(Boolean).join(" — ");
    if (cabecalho) linhas.push(cabecalho.toUpperCase());

    for (const m of bloco.movimentos) linhas.push(`- ${resumoDoMovimento(m)}`);

    const resultado = resultadoEmTexto(bloco.resultado);
    if (resultado) linhas.push(`= ${resultado} (${rotuloDaEscala(bloco.escala?.nivel)})`);

    linhas.push("");
  }

  if ((wod?.tamanhoDoTime ?? 1) > 1) {
    const parceiros = wod?.parceiros?.length ? `: ${wod.parceiros.join(", ")}` : "";
    linhas.push(`Em ${wod!.tamanhoDoTime}${parceiros}`);
  }

  return linhas.join("\n").trim();
}

/**
 * As duas ou três linhas do card.
 *
 * Deliberadamente curto: o bloco que tem resultado, e o esforço. Quem quiser o
 * aquecimento abre o treino.
 */
export function linhasDoCard(
  wod: PayloadDeCrossfit | null | undefined,
  rpe?: number | null
): string[] {
  const linhas: string[] = [];
  const principal = blocoPrincipal(wod);

  if (principal) {
    const titulo = principal.nome?.trim() || principal.modo;
    linhas.push(
      [titulo, resultadoEmTexto(principal.resultado), rotuloDaEscala(principal.escala?.nivel)]
        .filter(Boolean)
        .join(" · ")
    );
  }

  // As outras partes do WOD que também têm resultado: um treino de três
  // blocos tem três marcas, e mostrar só a primeira esconde duas.
  const outras = blocosComResultado(wod).filter((b) => b !== principal);
  if (outras.length) {
    linhas.push(
      outras
        .map((b) => [b.nome || b.modo, resultadoEmTexto(b.resultado)].filter(Boolean).join(" "))
        .join(" · ")
    );
  }

  if ((wod?.tamanhoDoTime ?? 1) > 1) linhas.push(`Em ${wod!.tamanhoDoTime}`);
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
