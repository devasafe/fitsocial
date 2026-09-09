import { apiFetch } from "./client";

export interface WaterLog {
  id: string;
  date: string;
  ml: number;
  createdAt: string;
}
export interface WaterDay {
  logs: WaterLog[];
  total: number;
  goalMl: number;
  goalIsCustom: boolean;
}

export async function getWaterDay(token: string, date: string): Promise<WaterDay> {
  return apiFetch<WaterDay>(`/water/day?date=${date}`, { token });
}
export async function addWater(token: string, date: string, ml: number): Promise<WaterLog> {
  return (await apiFetch<{ data: WaterLog }>("/water/logs", { method: "POST", token, body: { date, ml } })).data;
}
export async function deleteWater(token: string, id: string): Promise<void> {
  await apiFetch(`/water/logs/${id}`, { method: "DELETE", token });
}
export async function setWaterGoal(token: string, goalMl: number): Promise<void> {
  await apiFetch("/water/goal", { method: "PUT", token, body: { goalMl } });
}
