import { apiFetch } from "./client";
import { API_BASE_URL } from "../config";

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
  /** Porção em gramas. Null quando foi digitado sem essa informação. */
  gramas?: number | null;
  origem?: "manual" | "foto";
}

/** Um alimento que a IA reconheceu na foto. Ainda NÃO está no diário. */
export interface ItemEstimado {
  nome: string;
  gramas: number;
  kcal: number;
  proteinaG: number;
  carboG: number;
  gorduraG: number;
  /** Baixa = a pessoa precisa olhar com atenção antes de confirmar. */
  confianca: "alta" | "media" | "baixa";
}

export interface AnaliseDaFoto {
  itens: ItemEstimado[];
  /** O que a IA não conseguiu determinar. Vazio quando não há ressalva. */
  observacao: string;
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
  gramas?: number;
  origem?: "manual" | "foto";
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

export async function fetchRecentFoods(token: string): Promise<{ name: string; kcal: number; proteinG: number }[]> {
  const res = await apiFetch<{ data: { name: string; kcal: number; proteinG: number }[] }>("/nutrition/recent-foods", { token });
  return res.data;
}

/**
 * Manda a foto do prato e recebe a ESTIMATIVA — nada é gravado.
 *
 * Quem confirma é a pessoa, na tela seguinte: um modelo de visão estima a
 * porção pela aparência, ele não pesa o prato.
 */
export async function analisarFoto(token: string, form: FormData): Promise<AnaliseDaFoto> {
  // fetch direto e nao apiFetch: aquele forca Content-Type JSON, e multipart
  // precisa que o proprio fetch monte o boundary. Mesmo caminho do upload.
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/nutrition/analisar-foto`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      // Analisar imagem demora mais que texto; sem prazo a tela gira para
      // sempre quando o modelo engasga.
      signal: AbortSignal.timeout(90_000),
    });
  } catch (err) {
    const nome = (err as Error)?.name;
    throw new Error(
      nome === "TimeoutError" || nome === "AbortError"
        ? "A análise demorou demais. Tente de novo, ou registre na mão."
        : "Sem conexão com o servidor. Verifique sua internet."
    );
  }

  const data = (await res.json().catch(() => ({}))) as { data?: AnaliseDaFoto; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Não consegui analisar a foto");
  return data.data ?? { itens: [], observacao: "" };
}

export const MEAL_LABEL: Record<Meal, string> = {
  cafe: "Café da manhã",
  almoco: "Almoço",
  lanche: "Lanche",
  janta: "Jantar",
};
