import { apiFetch } from "./client";

export type Meal = "cafe" | "almoco" | "lanche" | "janta";

export interface FoodLog {
  id: string;
  date: string;
  meal: Meal;
  name: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface DaySummary {
  logs: FoodLog[];
  totals: { kcal: number; proteinG: number; carbsG: number; fatG: number };
  target: { dailyCalories: number; macros: { proteinG: number; carbsG: number; fatG: number } | null } | null;
}

export interface LogFoodInput {
  date: string;
  meal: Meal;
  name: string;
  kcal: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
}

export async function getDay(token: string, date: string): Promise<DaySummary> {
  return apiFetch<DaySummary>(`/nutrition/day?date=${date}`, { token });
}
export async function logFood(token: string, input: LogFoodInput): Promise<FoodLog> {
  return (await apiFetch<{ data: FoodLog }>("/nutrition/logs", { method: "POST", body: input, token })).data;
}
export async function deleteFood(token: string, id: string): Promise<void> {
  await apiFetch(`/nutrition/logs/${id}`, { method: "DELETE", token });
}

export const MEAL_LABEL: Record<Meal, string> = {
  cafe: "Café da manhã",
  almoco: "Almoço",
  lanche: "Lanche",
  janta: "Jantar",
};
