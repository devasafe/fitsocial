import { apiFetch, ApiHttpError } from "./client";

export interface Exercise {
  name: string;
  sets: number;
  reps: string;
  restSeconds: number;
  notes: string;
  kind?: "strength" | "cardio";
}
export interface Session {
  day: string;
  focus: string;
  exercises: Exercise[];
  /** Em que dias da semana esta sessão acontece. 0=domingo … 6=sábado.
   *  Ausente ou vazio = a pessoa ainda não escolheu. */
  weekdays?: number[];
}
export interface Workout {
  split: string;
  daysPerWeek: number;
  sessions: Session[];
}
export interface Meal {
  name: string;
  timeHint: string;
  items: { food: string; quantity: string }[];
}
export interface Diet {
  dailyCalories: number;
  macros: { proteinG: number; carbsG: number; fatG: number };
  meals: Meal[];
  notes: string;
}
export interface Plan {
  id: string;
  version: number;
  summary: string;
  /** Nula para quem segue a programação do box e nunca gerou treino. */
  workout: Workout | null;
  /** Nula para quem tem treino mas ainda não pediu dieta. */
  diet: Diet | null;
  disclaimer: string;
  /**
   * Quem escreveu, quando não foi a IA. Nulo no plano gerado.
   *
   * O id sozinho não dá para escrever "prescrito por" numa tela, e é essa
   * frase que separa um treino que um profissional assinou de um que um
   * modelo gerou.
   */
  autor: { id: string; nome: string; username: string | null; avatarUrl: string } | null;
  createdAt: string;
}

/** Gera só a dieta — sem carregar junto um treino que a pessoa não vai usar. */
export function generateDiet(token: string) {
  return apiFetch<{ plan: Plan }>("/plans/diet", { method: "POST", token });
}

/** Apaga o plano inteiro e devolve a pessoa à escolha de como treina. */
export function zerarPlano(token: string) {
  return apiFetch<{ data: { removidos: number } }>("/plans/current", {
    method: "DELETE",
    token,
  });
}

/** Apaga uma metade só. A outra continua de pé. */
export function zerarParteDoPlano(token: string, parte: "workout" | "diet") {
  return apiFetch<{ data: { plan: Plan | null }; meta: { vazio?: boolean } }>(
    `/plans/current/${parte}`,
    { method: "DELETE", token }
  );
}

export function generatePlan(token: string) {
  return apiFetch<{ plan: Plan }>("/plans/generate", { method: "POST", token });
}

/** Reajuste do plano pela IA com base na adesão (premium). */
export function adjustPlan(token: string) {
  return apiFetch<{ plan: Plan }>("/plans/adjust", { method: "POST", token });
}

/** Importa o plano pessoal do usuário (texto) — a IA estrutura no formato do app. */
export function importPlan(token: string, text: string) {
  return apiFetch<{ plan: Plan }>("/plans/import", { method: "POST", token, body: { text } });
}

/** Edição manual do plano (treino/dieta) — salva in place. */
export function updatePlan(token: string, data: { summary?: string; workout?: Workout; diet?: Diet }) {
  return apiFetch<{ plan: Plan }>("/plans/current", { method: "PUT", token, body: data });
}

// ------------------------------------------------------------- o treino de hoje

/** A sessão como a semana mostra: o suficiente para escolher outro dia. */
export interface SessaoResumida {
  day: string;
  focus: string;
  exerciciosCount: number;
  weekdays: number[];
}

/** Uma sessão à espera de dia, na tela de encaixe. */
export interface SessaoSemDia extends SessaoResumida {
  indice: number;
  /** Palpite lido do nome ("Segunda" → [1]). Só pré-preenche; nada foi gravado. */
  sugestao: number[];
}

/**
 * O que o servidor responde sobre hoje.
 *
 * `estado` é o discriminante: a tela faz um `switch` nele em vez de deduzir o
 * caso do cruzamento de três nulos.
 */
export interface TreinoDeHoje {
  estado: "treino_de_hoje" | "descanso" | "sem_agenda" | "sem_plano";
  diaDaSemana: number;
  planVersion: number | null;
  sessao: Session | null;
  /** As sete posições, sempre — trocar de dia não custa outra ida ao servidor. */
  semana: { diaDaSemana: number; sessao: SessaoResumida | null }[];
  /** Só em `sem_agenda`. */
  sessoes?: SessaoSemDia[];
}

export interface MetaDeHoje {
  fuso: string;
  hoje: string;
  /** Qual é hoje de verdade — não muda quando a tela espia outro dia. */
  diaDaSemana: number;
  naoAgendadas: number;
  /** Falso para quem tem treinador: não se acrescenta sessão à prescrição. */
  podeEditarPlano: boolean;
  programacao: "plano" | "propria" | null;
}

/** O treino de hoje. `dia` só para espiar outro dia da semana. */
export function getTreinoDeHoje(token: string, dia?: number) {
  const q = dia === undefined ? "" : `?dia=${dia}`;
  return apiFetch<{ data: TreinoDeHoje; meta: MetaDeHoje }>(`/plans/hoje${q}`, { token });
}

/** Em que dias você treina — grava a grade inteira de uma vez. */
export function salvarAgenda(
  token: string,
  /** `day` vai junto: é o que faz o servidor perceber que o plano mudou por
   *  outra tela e os índices deslizaram. */
  agenda: { indice: number; day: string; weekdays: number[] }[],
  versao?: number
) {
  return apiFetch<{ data: { plan: Plan }; meta: { diasOcupados: number; naoAgendadas: number } }>(
    "/plans/current/agenda",
    { method: "PUT", token, body: { agenda, ...(versao === undefined ? {} : { versao }) } }
  );
}

/** "Quer adicionar este treino ao plano?" — o sim. */
export function adicionarSessaoAoPlano(
  token: string,
  data: { activityId: string; day?: string; focus?: string; weekdays: number[] }
) {
  return apiFetch<{
    data: { plan: Plan };
    meta: {
      criouPlano: boolean;
      sessionDay: string;
      /** Sessões que perderam um dia para esta. Vazio no caso comum. */
      diasTomadosDe: string[];
    };
  }>(
    "/plans/current/sessoes",
    { method: "POST", token, body: data }
  );
}

/**
 * Busca o plano atual; devolve null quando ainda não há.
 *
 * O servidor responde 200 com `plan: null` — não ter plano é o estado normal
 * de quem acabou de se cadastrar, e um 404 por isso enchia o console de erro a
 * cada foco da Home. O `catch` do 404 continua aqui porque o deploy é manual:
 * o aplicativo pode rodar contra um servidor mais antigo por algum tempo.
 */
export async function getCurrentPlan(token: string): Promise<Plan | null> {
  try {
    const { plan } = await apiFetch<{ plan: Plan | null }>("/plans/current", { token });
    return plan;
  } catch (err) {
    if (err instanceof ApiHttpError && err.status === 404) return null;
    throw err;
  }
}
