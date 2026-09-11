// Lê o `modo` que o coach escreveu e devolve o que dá para entender dele.
//
// Roda NO SALVAMENTO, nunca durante a digitação: interpretar a cada tecla faz o
// campo pular embaixo do dedo enquanto a pessoa ainda está no meio da frase.
//
// A regra dura: **isto nunca bloqueia e nunca inventa.** Não reconheceu, devolve
// `familia: "livre"` e segue — o treino é salvo igual, só sem timer automático.
// E número que não está escrito não aparece aqui: "TABATA" tem definição
// canônica (20/10 × 8) e mesmo assim os campos ficam nulos, porque um número
// que o app inventou é indistinguível de um número que o coach prescreveu.
//
// Ver docs/superpowers/specs/2026-09-11-cadastro-de-treino-briefing.md.

import {
  VERSAO_DO_INTERPRETADOR,
  type Leitura,
  type FamiliaDeModo,
} from "../../models/crossfit.js";

/** Caixa alta, sem acento, espaço normalizado. Compara-se o texto, não o estilo. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * O tempo como o quadro escreve.
 *
 *   6'        → 360        1'15"     → 75
 *   90"       → 90         20:00     → 1200
 *   7 MIN     → 420        45 SEG    → 45
 *
 * Devolve `null` quando não há tempo nenhum — e não 0, que seria confundido com
 * "zero segundos prescritos".
 */
export function tempoEmSegundos(texto: string): number | null {
  const t = normalizar(texto);

  // 1'15" — minutos e segundos colados. Antes das outras, senão o 1' casa
  // sozinho e o 15" vira outro tempo.
  const composto = t.match(/(\d+)\s*'\s*(\d{1,2})\s*"?/);
  if (composto) return Number(composto[1]) * 60 + Number(composto[2]);

  // 20:00
  const relogio = t.match(/(\d+)\s*:\s*(\d{2})\b/);
  if (relogio) return Number(relogio[1]) * 60 + Number(relogio[2]);

  // 6' / 6 MIN / 6 MINUTOS
  const minutos = t.match(/(\d+)\s*(?:'|MIN\b|MINS\b|MINUTOS?\b)/);
  if (minutos) return Number(minutos[1]) * 60;

  // 90" / 90 SEG / 90 S
  const segundos = t.match(/(\d+)\s*(?:"|SEG\b|SEGS\b|SEGUNDOS?\b|S\b)/);
  if (segundos) return Number(segundos[1]);

  return null;
}

/** O "x 4" de "EMOM (1'15\") x 4", ou o "5" de "5 ROUNDS FOR TIME". */
function rounds(t: string): number | null {
  const vezes = t.match(/(?:X|×)\s*(\d+)\b/);
  if (vezes) return Number(vezes[1]);

  const antes = t.match(/(\d+)\s*(?:ROUNDS?|RDS?|VOLTAS?)\b/);
  if (antes) return Number(antes[1]);

  return null;
}

/** E2MOM = 120, "EVERY 3 MIN" = 180. O EMOM pelado NÃO entra aqui. */
function intervaloExplicito(t: string): number | null {
  const enmom = t.match(/\bE\s*(\d+)\s*MOM\b/);
  if (enmom) return Number(enmom[1]) * 60;

  const every = t.match(/\b(?:EVERY|A CADA|CADA)\s+(\d+)\s*(?:'|MIN\w*)/);
  if (every) return Number(every[1]) * 60;

  return null;
}

function ehEmom(t: string): boolean {
  return /\bEMOM\b/.test(t) || intervaloExplicito(t) !== null;
}

/**
 * O tempo entre parênteses, se houver.
 *
 * É a convenção do quadro, e ela desempata o caso mais chato: em
 * `EMOM (1'15") x 4` os 75s são a JANELA, enquanto em `EMOM 10'` os 10 minutos
 * são a duração total e a janela é o minuto implícito. O que separa os dois é
 * o parêntese, não o número.
 */
function tempoEntreParenteses(t: string): number | null {
  const m = t.match(/\(([^)]*)\)/);
  return m ? tempoEmSegundos(m[1]) : null;
}

/** Escada colada como modo: "21-15-9", "21/15/9". */
function ehEscada(t: string): boolean {
  return /^\d{1,3}\s*[-/]\s*\d{1,3}(\s*[-/]\s*\d{1,3})*$/.test(t);
}

const SCORE_POR_FAMILIA: Record<FamiliaDeModo, Leitura["scoreSugerido"]> = {
  amrap: "rounds_reps",
  for_time: "tempo",
  rft: "tempo",
  emom: "reps",
  tabata: "reps",
  intervalo: "reps",
  max_reps: "reps",
  max_load: "carga",
  descanso: "nenhum",
  // Sem estrutura reconhecida não há score óbvio: quem escolhe é a pessoa.
  livre: null,
};

function familiaDe(t: string): FamiliaDeModo {
  // Descanso primeiro: "REST 1'" tem um tempo que qualquer outra regra
  // sequestraria como duração de trabalho.
  if (/\b(?:REST|DESCANSO|PAUSA)\b/.test(t)) return "descanso";

  if (/\bTABATA\b/.test(t)) return "tabata";
  if (ehEmom(t)) return "emom";

  if (/\bAMRAP\b/.test(t)) return "amrap";

  // "5 ROUNDS FOR TIME" é rft; "FOR TIME" sozinho é for_time. A diferença
  // importa porque uma tem número de rounds prescrito e a outra não.
  if (/\bFOR TIME\b|\bFT\b/.test(t)) {
    return rounds(t) !== null ? "rft" : "for_time";
  }
  if (/\bRFT\b/.test(t)) return "rft";

  if (/\b(?:MAX REPS?|MAXIMO DE REPS?|MAX EFFORT REPS?)\b/.test(t)) return "max_reps";
  if (/\b(?:SKILL|STRENGTH|FORCA|MAX LOAD|1RM|\d+RM)\b/.test(t)) return "max_load";
  if (/\b(?:INTERVALO|INTERVAL|ESTACAO|ESTACOES|STATIONS?)\b/.test(t)) return "intervalo";

  // Escada sem verbo — "21-15-9" no quadro quer dizer for time.
  if (ehEscada(t)) return "for_time";

  return "livre";
}

/**
 * O que dá para entender do modo escrito.
 *
 * Campo ausente quer dizer "não estava escrito", e não "é zero".
 */
export function interpretarModo(modo: string): Leitura {
  const t = normalizar(modo);
  const familia = familiaDe(t);
  const leitura: Leitura = {
    familia,
    scoreSugerido: SCORE_POR_FAMILIA[familia],
    versao: VERSAO_DO_INTERPRETADOR,
  };

  const qtdRounds = rounds(t);
  if (qtdRounds !== null) leitura.rounds = qtdRounds;

  const tempo = tempoEmSegundos(t);

  if (familia === "emom" || familia === "tabata" || familia === "intervalo") {
    // Aqui o tempo escrito é o TAMANHO DA JANELA, não a duração do bloco:
    // "EMOM (1'15\") x 4" são quatro janelas de 75s, e não 75s de treino.
    const intervalo =
      intervaloExplicito(t) ??
      tempoEntreParenteses(t) ??
      // Fora do EMOM o tempo escrito já É a janela: "1 min por estação".
      (familia === "emom" ? 60 : tempo);
    if (intervalo !== null) leitura.intervaloSec = intervalo;

    // "EMOM 10'": a janela é o minuto implícito, os 10 minutos são o total.
    if (intervalo !== null && tempo !== null && tempo !== intervalo) {
      leitura.duracaoSec = tempo;
    } else if (intervalo !== null && leitura.rounds) {
      leitura.duracaoSec = intervalo * leitura.rounds;
    }
  } else if (familia === "for_time" || familia === "rft") {
    // Tempo em FOR TIME é teto, não alvo: "FOR TIME 7'" quer dizer "acabe
    // antes de 7 minutos", e quem estourar tem score capado, não tempo.
    if (tempo !== null) leitura.timeCapSec = tempo;
  } else if (tempo !== null) {
    leitura.duracaoSec = tempo;
  }

  return leitura;
}
