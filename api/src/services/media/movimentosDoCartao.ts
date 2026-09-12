// Os exercícios do treino, em uma linha cada, para o cartão de compartilhar.
//
// O cartão mostra "21-15-9  Thruster  43 kg", e nenhum lugar do sistema guarda
// essa frase pronta: o `metrics.movimentos` guarda só as chaves ("thruster"),
// que servem para consultar e não para ler.
//
// Corrida e pedal não entram: ali o conteúdo é o percurso e o pace, e listar
// "Corrida" embaixo de "5,2 km" não diz nada a ninguém.

import type { Movimento, WodPayload } from "../../models/crossfit.js";
import type { StrengthPayload } from "../../models/strength.js";

/** Quantos cabem antes de o próprio layout cortar com "e mais N". */
const MAXIMO = 8;

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Decimal com vírgula: "62.5 kg" é um número escrito em outra língua. */
function numero(v: number): string {
  return String(Math.round(v * 100) / 100).replace(".", ",");
}

/** "21-15-9", "100 m", "20 cal", "1:00" — o "quanto" do movimento. */
function quantidade(m: Movimento): string {
  const v = m.volume;
  if (!v) return "";
  const valor = Array.isArray(v.valor) ? v.valor.join("-") : String(v.valor);

  switch (v.unidade) {
    case "metros":
      return `${valor} m`;
    case "cal":
      return `${valor} cal`;
    case "seg":
      return Array.isArray(v.valor) ? `${valor} s` : mmss(v.valor);
    default:
      return valor;
  }
}

/** "43 kg", "43/30 kg", "70% 1RM", "colete de 10 kg" — ou nada, o caso comum. */
function carga(m: Movimento): string {
  const c = m.carga;
  if (!c) return "";
  if (c.texto) return c.texto;
  if (c.rx == null) return "";

  // As duas prescrições do quadro na mesma linha, como o quadro escreve.
  const valores = c.rxF != null ? `${numero(c.rx)}/${numero(c.rxF)}` : numero(c.rx);

  switch (c.unidade) {
    case "kg":
      return `${valores} kg`;
    case "lb":
      return `${valores} lb`;
    case "percent_1rm":
      return `${valores}% 1RM`;
    default:
      // "corporal" e "livre" sem texto: o número sozinho não significaria nada.
      return "";
  }
}

function umaLinha(m: Movimento): string {
  const series = m.series ? `${m.series}×` : "";
  const escopo = m.escopo === "cada" ? "(cada)" : m.escopo === "junto" ? "(junto)" : "";

  return [series + quantidade(m), m.nome, carga(m), escopo].filter(Boolean).join("  ");
}

/**
 * Os blocos que o cartão mostra.
 *
 * Os que têm resultado, porque resultado é o que a pessoa se deu ao trabalho de
 * anotar. Nenhum tem: os que não são descanso nem "livre" — o que deixa
 * aquecimento e mobilidade de fora, que é a mesma regra do card do feed.
 */
function blocosQueImportam(wod: WodPayload) {
  const blocos = wod.blocos ?? [];
  const comResultado = blocos.filter((b) => b.resultado);
  if (comResultado.length) return comResultado;
  return blocos.filter((b) => b.lido?.familia !== "descanso" && b.lido?.familia !== "livre");
}

function doCrossfit(wod: WodPayload): string[] {
  // `?? []` não é paranoia: o payload chega CRU do Mongo (o campo é `Mixed`),
  // sem passar pelo zod, então um bloco sem movimentos existe de verdade — o
  // REST é exatamente isso. Aqui já quebrou com "Cannot read properties of
  // undefined".
  return blocosQueImportam(wod).flatMap((b) => (b.movimentos ?? []).map(umaLinha));
}

function daForca(exercicios: StrengthPayload["exercises"]): string[] {
  return exercicios
    .filter((e) => e?.name)
    .map((e) => {
      // Só séries válidas: aquecimento e drop não são o treino que a pessoa
      // está contando — a mesma regra do volume em activityMetrics.
      //
      // `?? []` pelo mesmo motivo do bloco de CrossFit acima: o payload vem CRU
      // do Mongo. Agora que isto serve o feed de força inteiro, um exercício
      // torto derrubaria a listagem de todo mundo, não uma imagem.
      const todas = Array.isArray(e.sets) ? e.sets : [];
      const validas = todas.filter((s) => s?.type === "valida" && s.done);
      const usadas = validas.length ? validas : todas;
      const reps = usadas.find((s) => s?.reps != null)?.reps;
      // `Math.max(...array)` empilha um argumento por série. Enquanto isto
      // desenhava uma imagem sob demanda, o pior caso era uma imagem falhar;
      // agora serve o feed inteiro, e uma série a mais do que a pilha aguenta
      // derrubaria a listagem de todo mundo que segue a pessoa.
      const peso = usadas.reduce((maior, s) => Math.max(maior, s?.weightKg ?? 0), 0);

      return [
        reps != null ? `${usadas.length}×${reps}` : `${usadas.length} séries`,
        e.name,
        peso > 0 ? `${numero(peso)} kg` : "",
      ]
        .filter(Boolean)
        .join("  ");
    });
}

/** Todas as linhas, sem corte — a base das duas funções abaixo. */
function todasAsLinhas(
  kind: string | undefined,
  payload: Record<string, unknown> | undefined
): string[] {
  if (!payload) return [];

  let linhas: string[] = [];

  if (Array.isArray(payload.blocos)) {
    linhas = doCrossfit(payload as unknown as WodPayload);
  } else if (kind === "strength" && Array.isArray(payload.exercises)) {
    linhas = daForca(payload.exercises as StrengthPayload["exercises"]);
  }

  return linhas.filter((l) => l.trim());
}

/**
 * Os movimentos de um treino, prontos para desenhar. Lista vazia quando o
 * treino não tem movimento para mostrar — o layout lida com isso.
 */
export function movimentosDoCartao(
  kind: string | undefined,
  payload: Record<string, unknown> | undefined
): string[] {
  return todasAsLinhas(kind, payload).slice(0, MAXIMO);
}

/**
 * Quantos movimentos o treino tem DE VERDADE.
 *
 * Existe porque o corte acontece duas vezes: aqui em oito, e de novo no cartão
 * do app em seis. Sem este número, o "+N exercícios" do cartão era calculado
 * sobre a lista já cortada e dizia "+2" para todo treino de oito ou mais — quem
 * fez quinze exercícios lia que faltavam dois.
 */
export function totalDeMovimentos(
  kind: string | undefined,
  payload: Record<string, unknown> | undefined
): number {
  return todasAsLinhas(kind, payload).length;
}
