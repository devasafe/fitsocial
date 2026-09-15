// A agenda do treino: em que dias da semana cada sessão do plano acontece.
//
// Até aqui o plano não tinha eixo temporal. `session.day` é texto livre ("Dia A
// — Peito e Tríceps") e a Home mostrava sempre `sessions[0]`, fosse terça ou
// domingo. "Treino de terça" simplesmente não era representável.
//
// O campo novo é `session.weekdays` (ver `models/Plan.ts`). Este módulo guarda
// as três regras que giram em volta dele, e nenhuma delas cabe numa rota:
//
//  1. `preservarAgenda` — impedir que quem NÃO conhece o campo o apague.
//  2. `sugerirWeekdays` — ler um dia do texto livre, só para sugerir.
//  3. `normalizarWeekdays` — ordenar e tirar repetido.

import { HttpError } from "../utils/httpError.js";
import type { WorkoutData, SessionData } from "../models/Plan.js";

/** 0=domingo … 6=sábado, na ordem em que a semana se escreve. */
export const DIAS_DA_SEMANA = [
  "domingo",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
] as const;

/** Sem repetido e em ordem. A agenda é um conjunto, não uma sequência. */
export function normalizarWeekdays(dias: readonly number[] | undefined): number[] {
  if (!dias?.length) return [];
  const limpos = dias.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  return [...new Set(limpos)].sort((a, b) => a - b);
}

/**
 * A identidade de uma sessão, para efeito de merge.
 *
 * É o texto de `day`, que é a única identidade que o plano tem hoje — e é a
 * mesma chave que `Activity.planLink.sessionDay` usa. Não é boa: renomear a
 * sessão no editor faz ela perder o dia. É aceitável porque é visível (a pessoa
 * está justamente editando aquilo) e porque a alternativa — casar por índice —
 * erra pior: basta alguém inserir uma sessão no topo para a semana inteira
 * deslizar de dono. Um id estável de sessão é o conserto certo, e é migração.
 */
function chave(day: string): string {
  return day.trim().toLowerCase();
}

/**
 * Um dia não pode estar em duas sessões: a agenda precisa ser uma FUNÇÃO de dia
 * para sessão, senão "o treino de terça" tem duas respostas.
 *
 * Aqui, que é merge pelas costas, o conflito se resolve em silêncio. Quando ele
 * vem de um ato explícito da pessoa (a tela de encaixe), a regra é outra:
 * recusa com 400, dizendo qual dia.
 *
 * A ordem de preferência importa e não é só "o último da lista". Quem MANDOU o
 * dia ganha de quem o HERDOU — sem isso, um cliente que move "Dia B" para a
 * segunda e deixa "Dia A" sem `weekdays` via a própria escolha ser desfeita
 * pelo dia que "Dia A" herdou do plano anterior.
 */
function resolverConflitos(
  sessions: SessionData[],
  explicitos: ReadonlySet<number>
): SessionData[] {
  const dono = new Map<number, number>(); // dia -> índice da sessão que fica
  const ganha = (candidato: number, atual: number | undefined): boolean => {
    if (atual === undefined) return true;
    const candidatoExplicito = explicitos.has(candidato);
    if (candidatoExplicito !== explicitos.has(atual)) return candidatoExplicito;
    return true; // entre iguais, o último da lista leva
  };
  sessions.forEach((s, i) => {
    for (const d of s.weekdays ?? []) if (ganha(i, dono.get(d))) dono.set(d, i);
  });
  return sessions.map((s, i) => {
    if (!s.weekdays?.length) return s;
    const meus = normalizarWeekdays(s.weekdays.filter((d) => dono.get(d) === i));
    return { ...s, weekdays: meus };
  });
}

/**
 * Mantém a agenda que o dono montou quando quem reescreve o treino não sabe que
 * ela existe.
 *
 * O caso que obriga isto a existir: o APK instalado não se atualiza sozinho.
 * Ele manda `{day, focus, exercises}` no `PUT /plans/current`; o zod (que não
 * usa `.strict()` em lugar nenhum deste backend) descarta o que não conhece, a
 * rota substitui `plan.workout` inteiro, e a agenda evapora sem erro nenhum. O
 * mesmo vale para `POST /plans/adjust`, onde a IA reescreve o treino todo, e
 * para a prescrição do coach.
 *
 * Quem manda `weekdays` explicitamente ganha — inclusive `[]`, que quer dizer
 * "limpei de propósito". Só o `undefined` herda.
 */
export function preservarAgenda(
  anterior: WorkoutData | null | undefined,
  novo: WorkoutData
): WorkoutData {
  const antes = new Map<string, number[]>();
  for (const s of anterior?.sessions ?? []) {
    const ws = normalizarWeekdays(s.weekdays);
    if (ws.length) antes.set(chave(s.day), ws);
  }
  if (antes.size === 0) return novo;

  const explicitos = new Set<number>();
  const sessions = novo.sessions.map((s, i) => {
    if (s.weekdays !== undefined) {
      explicitos.add(i);
      return { ...s, weekdays: normalizarWeekdays(s.weekdays) };
    }
    const herdado = antes.get(chave(s.day));
    return herdado ? { ...s, weekdays: herdado } : s;
  });

  return { ...novo, sessions: resolverConflitos(sessions, explicitos) };
}

/**
 * Dá estes dias à sessão do índice, tirando de quem os tinha.
 *
 * É o que acontece quando alguém acrescenta "meu treino de terça" a um plano
 * que já tinha alguma coisa na terça. Aqui a sessão nova ganha, porque esse é o
 * pedido explícito da pessoa — e a outra sessão continua existindo, só que sem
 * aquele dia. O que não pode é a terça ter duas respostas.
 */
export function atribuirDias(
  sessions: readonly SessionData[],
  indice: number,
  weekdays: readonly number[]
): { sessions: SessionData[]; tomadosDe: string[] } {
  const meus = normalizarWeekdays(weekdays);
  const tomados = new Set(meus);
  // Quem perdeu um dia sai pelo nome: em silêncio, "Dia A" ficaria sem a terça
  // e a pessoa só descobriria na terça seguinte.
  const tomadosDe: string[] = [];
  const out = sessions.map((s, i) => {
    if (i === indice) return { ...s, weekdays: meus };
    const antes = normalizarWeekdays(s.weekdays);
    const restantes = antes.filter((d) => !tomados.has(d));
    if (restantes.length === antes.length) return s;
    tomadosDe.push(s.day);
    return { ...s, weekdays: restantes };
  });
  return { sessions: out, tomadosDe };
}

// ------------------------------------------------------- leitura do dia no texto

/** Sem acento e em minúsculas, para o casamento não depender de "terça" x "terca". */
function semAcento(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Como cada dia pode aparecer escrito. O índice é o próprio dia da semana. */
const APELIDOS: readonly (readonly string[])[] = [
  ["domingo", "dom"],
  ["segunda", "seg"],
  ["terca", "ter"],
  ["quarta", "qua"],
  ["quinta", "qui"],
  ["sexta", "sex"],
  ["sabado", "sab"],
];

/**
 * O que dá para ler de um nome de sessão escrito à mão — e nada além.
 *
 * SUGESTÃO, nunca gravada sozinha. O texto é ambíguo de verdade: "Dia 2" é a
 * segunda sessão ou terça-feira? "Dia A — Segunda parte" casa com "segunda". E
 * a falha é assimétrica: um palpite errado faz a pessoa treinar o treino errado
 * na terça de manhã, e isso não vira relato de bug — vira "o app é burro". Um
 * palpite ausente custa um toque numa tela que ia aparecer de qualquer jeito.
 *
 * "Seg/Qui" devolve os dois: dois dias inequívocos, e o campo é array.
 */
export function sugerirWeekdays(day: string): number[] {
  const texto = semAcento(day);
  const achados: number[] = [];
  APELIDOS.forEach((apelidos, dia) => {
    // Borda de palavra para "ter" não casar dentro de "intervalado".
    const bate = apelidos.some((a) => new RegExp(`\\b${a}\\b`).test(texto));
    if (bate) achados.push(dia);
  });
  return normalizarWeekdays(achados);
}

// ------------------------------------------------------------------ leitura

/** A sessão de cada dia da semana, do domingo ao sábado. `null` onde não há. */
export function agendaPorDia(workout: WorkoutData | null | undefined): (SessionData | null)[] {
  const semana: (SessionData | null)[] = Array.from({ length: 7 }, () => null);
  for (const s of workout?.sessions ?? []) {
    for (const d of normalizarWeekdays(s.weekdays)) semana[d] = s;
  }
  return semana;
}

/** Quantas sessões do plano ainda não têm dia marcado. */
export function sessoesSemDia(workout: WorkoutData | null | undefined): number {
  return (workout?.sessions ?? []).filter((s) => normalizarWeekdays(s.weekdays).length === 0).length;
}

// --------------------------------------------------------- o plano de um dia

/** O nome do dia em maiúscula inicial, para mensagem de erro. */
function nomeDoDia(dia: number): string {
  const n = DIAS_DA_SEMANA[dia] ?? "";
  return n ? `${n[0]!.toUpperCase()}${n.slice(1)}` : String(dia);
}

/** A sessão como a semana mostra: o suficiente para escolher outro dia. */
export interface SessaoResumida {
  day: string;
  focus: string;
  exerciciosCount: number;
  weekdays: number[];
}

/** A mesma, com o índice que a tela de encaixe usa para escrever de volta. */
export interface SessaoComIndice extends SessaoResumida {
  indice: number;
  sugestao: number[];
}

export type EstadoDoDia = "treino_de_hoje" | "descanso" | "sem_agenda" | "sem_plano";

export interface PlanoDoDia {
  estado: EstadoDoDia;
  /** A sessão do dia pedido, com os exercícios inteiros. */
  sessao: SessionData | null;
  sessoes: SessaoComIndice[];
  semana: { diaDaSemana: number; sessao: SessaoResumida | null }[];
}

function resumir(s: SessionData): SessaoResumida {
  return {
    day: s.day,
    focus: s.focus,
    exerciciosCount: s.exercises.length,
    weekdays: normalizarWeekdays(s.weekdays),
  };
}

/**
 * Em que estado está o plano de quem pergunta "o que eu treino hoje?".
 *
 * Mora aqui, e não na rota, porque é a decisão mais importante da feature: o
 * `switch` que a tela faz sai deste `estado`. Na rota, testá-la exigiria subir
 * Mongo e supertest para cada caso.
 *
 * `completar` injeta o preenchimento de `kind` (que vive em `exerciseKind`) sem
 * acoplar este módulo a ele — e clonando, porque quem preenche muta in place e
 * escrever de volta num `Mixed` hidratado gravaria no documento.
 */
export function montarPlanoDoDia(
  workout: WorkoutData | null | undefined,
  alvo: number,
  completar: (s: SessionData) => SessionData
): PlanoDoDia {
  const sessions = workout?.sessions ?? [];
  const semana = agendaPorDia(workout).map((s, dia) => ({
    diaDaSemana: dia,
    sessao: s ? resumir(s) : null,
  }));

  // `sessoes` vai em TODO estado, inclusive vazio em `sem_plano`: um campo que
  // existe em três estados e some no quarto vira `undefined.length` na tela.
  const sessoes: SessaoComIndice[] = sessions.map((s, indice) => ({
    indice,
    ...resumir(s),
    // Palpite lido do nome, para a grade já vir preenchida quando não há dia
    // nenhum. Nunca é gravado sozinho — ver `sugerirWeekdays`.
    sugestao: sugerirWeekdays(s.day),
  }));

  if (sessions.length === 0) {
    return { estado: "sem_plano", sessao: null, sessoes: [], semana };
  }

  // `sem_agenda` só quando NENHUMA sessão tem dia. Decidir por completude
  // jogaria todo mundo de volta à tela de encaixe toda vez que um coach
  // acrescentasse uma sessão a um plano já agendado.
  if (sessoesSemDia(workout) === sessions.length) {
    return { estado: "sem_agenda", sessao: null, sessoes, semana };
  }

  const sessao = agendaPorDia(workout)[alvo] ?? null;
  return {
    estado: sessao ? "treino_de_hoje" : "descanso",
    sessao: sessao ? completar(sessao) : null,
    sessoes,
    semana,
  };
}

/** Um item da grade que a tela de encaixe manda de volta. */
export interface ItemDaAgenda {
  indice: number;
  /** O nome que a tela leu, quando ela o mandou. */
  day?: string;
  weekdays: number[];
}

/**
 * Aplica a grade inteira, recusando o que é ambíguo.
 *
 * Substituição total: índice não citado fica sem dia. Patch tornaria "tirei o
 * Dia C da quarta" indistinguível de "não mexi no Dia C".
 *
 * Aqui o conflito é ERRO, ao contrário do merge de `preservarAgenda`: este é um
 * ato explícito da pessoa, e engolir metade do que ela pediu é pior do que
 * dizer que segunda-feira já está ocupada.
 */
export function aplicarAgenda(
  workout: WorkoutData,
  itens: readonly ItemDaAgenda[]
): { sessions: SessionData[]; diasOcupados: number } {
  const dono = new Map<number, number>();

  for (const item of itens) {
    const alvo = workout.sessions[item.indice];
    // Índice fora da faixa, ou nome que não bate: o plano mudou por outra tela
    // desde que esta foi aberta, e os índices já deslizaram. `versao` sozinha
    // não pega isso — `PUT /plans/current` edita in place, sem incrementá-la.
    if (!alvo) throw new HttpError(409, "Seu plano mudou. Abra de novo para escolher os dias.");
    if (item.day !== undefined && chave(alvo.day) !== chave(item.day)) {
      throw new HttpError(409, "Seu plano mudou. Abra de novo para escolher os dias.");
    }
    for (const d of normalizarWeekdays(item.weekdays)) {
      const outro = dono.get(d);
      if (outro !== undefined && outro !== item.indice) {
        throw new HttpError(400, `${nomeDoDia(d)} já está com ${workout.sessions[outro]!.day}.`);
      }
      dono.set(d, item.indice);
    }
  }

  const escolhidos = new Map(itens.map((i) => [i.indice, normalizarWeekdays(i.weekdays)]));
  return {
    sessions: workout.sessions.map((s, i) => ({ ...s, weekdays: escolhidos.get(i) ?? [] })),
    diasOcupados: dono.size,
  };
}
