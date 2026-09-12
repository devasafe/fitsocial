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
