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
  workout: Workout;
  diet: Diet;
  disclaimer: string;
  createdAt: string;
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

/** Busca o plano atual; retorna null se ainda não houver (404). */
export async function getCurrentPlan(token: string): Promise<Plan | null> {
  try {
    const { plan } = await apiFetch<{ plan: Plan }>("/plans/current", { token });
    return plan;
  } catch (err) {
    if (err instanceof ApiHttpError && err.status === 404) return null;
    throw err;
  }
}
