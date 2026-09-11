// Os exercícios do treino, em uma linha cada, para o cartão de compartilhar.
//
// O cartão mostra "21-15-9  Thruster  43 kg", e nenhum lugar do sistema guarda
// essa frase pronta: o `metrics.movimentos` guarda só as chaves ("thruster"),
// que servem para consultar e não para ler.
//
// Três formatos de treino chegam aqui, e todos são reais em produção:
//   - CrossFit v2, com blocos e `repScheme`;
//   - o WOD antigo e plano (`payload.movements`), que o APK 1.2.0 ainda grava;
//   - força, onde "3×10 Supino  60 kg" é o equivalente do movimento.
//
// Corrida e pedal não entram: ali o conteúdo é o percurso e o pace, e listar
// "Corrida" embaixo de "5,2 km" não diz nada a ninguém.

import type { Movimento, Bloco } from "../../models/crossfit.js";
import type { StrengthPayload } from "../../models/strength.js";

/** Quantos cabem antes de o próprio layout cortar com "e mais N". */
const MAXIMO = 8;

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** "21-15-9", "100 m", "20 cal", "1:00" — o "quanto" do movimento. */
function quantidade(m: Movimento): string {
  if (m.repScheme?.length) return m.repScheme.join("-");
  if (m.reps != null) return String(m.reps);
  if (m.distanciaM != null) return `${m.distanciaM} m`;
  if (m.calorias != null) return `${m.calorias} cal`;
  if (m.duracaoSec != null) return mmss(m.duracaoSec);
  return "";
}

/** Decimal com vírgula: "62.5 kg" é um número escrito em outra língua. */
function numero(v: number): string {
  return String(Math.round(v * 100) / 100).replace(".", ",");
}

/** "43 kg", "70% 1RM", "colete de 10 kg" — ou nada, que é o caso comum. */
function carga(m: Movimento): string {
  const c = m.carga;
  if (!c) return "";
  if (c.texto) return c.texto;
  if (c.valor == null) return "";
  switch (c.unidade) {
    case "kg":
      return `${numero(c.valor)} kg`;
    case "lb":
      return `${numero(c.valor)} lb`;
    case "percent_1rm":
      return `${numero(c.valor)}% 1RM`;
    default:
      // "corporal" e "livre" sem texto: o número sozinho não significaria nada.
      return "";
  }
}

function doCrossfit(blocos: Bloco[]): string[] {
  const linhas: string[] = [];

  for (const bloco of blocos) {
    // Só o WOD. Aquecimento e mobilidade importam para quem treinou, não para
    // quem vê o story — a mesma regra do card do feed.
    if (bloco.tipo !== "metcon") continue;
    for (const m of bloco.prescricao.movimentos) {
      linhas.push(
        [quantidade(m), m.nome, carga(m), m.porPessoa ? "(cada)" : ""]
          .filter(Boolean)
          .join("  ")
      );
    }
  }

  return linhas;
}

interface MovimentoAntigo {
  name: string;
  reps?: number | null;
  loadKg?: number | null;
}

function doWodAntigo(movimentos: MovimentoAntigo[]): string[] {
  return movimentos
    .filter((m) => m?.name)
    .map((m) =>
      [m.reps != null ? String(m.reps) : "", m.name, m.loadKg != null ? `${numero(m.loadKg)} kg` : ""]
        .filter(Boolean)
        .join("  ")
    );
}

function daForca(exercicios: StrengthPayload["exercises"]): string[] {
  return exercicios
    .filter((e) => e?.name)
    .map((e) => {
      // Só séries válidas: aquecimento e drop não são o treino que a pessoa
      // está contando — a mesma regra do volume em activityMetrics.
      const validas = e.sets.filter((s) => s.type === "valida" && s.done);
      const usadas = validas.length ? validas : e.sets;
      const reps = usadas.find((s) => s.reps != null)?.reps;
      const peso = Math.max(0, ...usadas.map((s) => s.weightKg ?? 0));

      return [
        reps != null ? `${usadas.length}×${reps}` : `${usadas.length} séries`,
        e.name,
        peso > 0 ? `${Math.round(peso)} kg` : "",
      ]
        .filter(Boolean)
        .join("  ");
    });
}

/**
 * Os movimentos de um treino, prontos para desenhar. Lista vazia quando o
 * treino não tem movimento para mostrar — o layout lida com isso.
 */
export function movimentosDoCartao(
  kind: string | undefined,
  payload: Record<string, unknown> | undefined
): string[] {
  if (!payload) return [];

  let linhas: string[] = [];

  if (Array.isArray(payload.blocos)) {
    linhas = doCrossfit(payload.blocos as Bloco[]);
  } else if (Array.isArray(payload.movements)) {
    linhas = doWodAntigo(payload.movements as MovimentoAntigo[]);
  } else if (kind === "strength" && Array.isArray(payload.exercises)) {
    linhas = daForca(payload.exercises as StrengthPayload["exercises"]);
  }

  return linhas.filter((l) => l.trim()).slice(0, MAXIMO);
}
