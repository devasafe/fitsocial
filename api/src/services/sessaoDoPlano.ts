// Transformar um treino EXECUTADO numa sessão da ficha.
//
// É o que está por trás da pergunta "quer adicionar este treino ao plano?" que
// aparece ao salvar um treino montado à mão. O caminho existia só no sentido
// contrário: a ficha virava execução (`CheckIn`), e o treino livre morria no
// histórico sem nunca virar rotina.
//
// As duas formas não são a mesma coisa, e a conversão perde informação de
// propósito. `Activity` guarda o que aconteceu — carga real, série a série.
// `Plan.sessions[].exercises[]` guarda a prescrição — quantas séries, faixa de
// repetições, descanso. Aqui se extrai a prescrição de dentro do que foi feito.

import { STRENGTH_SET_TYPES } from "../models/strength.js";
import type { StrengthPayload } from "../models/strength.js";
import type { SessionData } from "../models/Plan.js";

/** Teto do `exerciseSchema` — passar disso reprova a ficha inteira na validação. */
const MAXIMO_DE_SERIES = 20;

/**
 * O descanso que a ficha precisa e a atividade não tem.
 *
 * `Activity` só guarda `restSec` por série quando alguém preencheu, e o
 * registro rápido nunca preenche. Sessenta segundos é o mesmo padrão que o
 * `CheckInScreen` já usa quando o exercício não traz descanso — então a pessoa
 * vê o número que ela veria de qualquer jeito, e pode mudar no editor da ficha.
 */
const DESCANSO_PADRAO_SEG = 60;

type TipoDeSerie = (typeof STRENGTH_SET_TYPES)[number];

/** Aquecimento não é prescrição: não conta série nem define a faixa de reps. */
function ehValida(tipo: TipoDeSerie | undefined): boolean {
  return tipo !== "aquecimento";
}

/**
 * Os exercícios da ficha a partir do que foi executado.
 *
 * Exportado à parte porque é o pedaço que dá para testar sem montar uma sessão
 * inteira.
 */
export function exerciciosDaAtividade(payload: StrengthPayload): SessionData["exercises"] {
  return payload.exercises
    .filter((e) => e.name?.trim())
    .map((e) => {
      const validas = e.sets.filter((s) => ehValida(s.type));
      // Um treino só de aquecimento ainda é um treino: cair para o total evita
      // uma sessão com zero séries, que o `exerciseSchema` recusaria.
      const contadas = validas.length || e.sets.length;

      return {
        name: e.name.trim(),
        sets: Math.min(Math.max(contadas, 1), MAXIMO_DE_SERIES),
        reps: prescricaoDaSerie(validas[0] ?? e.sets[0]),
        restSeconds: DESCANSO_PADRAO_SEG,
        notes: "",
        // `kind` fica de fora DE PROPÓSITO. `backfillWorkoutKinds` só preenche
        // o que está ausente, então carimbar "strength" aqui impediria o
        // classificador de rodar para sempre — e "Esteira, 20 min" entraria na
        // ficha como exercício de força, com as reps vazias.
      };
    });
}

/**
 * O que a ficha escreve no lugar de "repetições".
 *
 * `strengthSetSchema` aceita tempo e distância de propósito (é o legado de
 * anotar esteira dentro do treino de musculação), e `reps` vem nulo nesses
 * casos. Jogar isso fora transformava uma prancha de 45 segundos numa linha
 * sem número nenhum.
 */
function prescricaoDaSerie(s: StrengthPayload["exercises"][number]["sets"][number] | undefined): string {
  if (!s) return "";
  if (s.reps != null) return String(s.reps);
  if (s.holdSec != null) return `${s.holdSec}s`;
  if (s.durationMin != null) return `${s.durationMin} min`;
  if (s.distanceKm != null) return `${s.distanceKm} km`;
  return "";
}

/**
 * Um nome de sessão que ainda não existe na ficha.
 *
 * `day` é a chave de `Activity.planLink.sessionDay`: duas sessões com o mesmo
 * nome são duas respostas para "qual treino foi esse", e a adesão passa a
 * apontar para as duas. O editor manual ainda deixa criar duplicata — isso é
 * dívida conhecida —, mas nada que nasça aqui vai criar uma.
 */
export function nomeUnicoDeSessao(existentes: readonly string[], desejado: string): string {
  const usados = new Set(existentes.map((d) => d.trim().toLowerCase()));
  const base = desejado.trim() || "Meu treino";
  if (!usados.has(base.toLowerCase())) return base;
  for (let i = 2; i < 100; i++) {
    const tentativa = `${base} (${i})`;
    if (!usados.has(tentativa.toLowerCase())) return tentativa;
  }
  return `${base} (${Date.now()})`;
}

/** A sessão pronta para entrar em `Plan.workout.sessions`. */
export function sessaoDeAtividade(input: {
  payload: StrengthPayload;
  day: string;
  focus?: string;
  weekdays: number[];
}): SessionData {
  return {
    day: input.day,
    focus: input.focus?.trim() ?? "",
    exercises: exerciciosDaAtividade(input.payload),
    weekdays: input.weekdays,
  };
}
