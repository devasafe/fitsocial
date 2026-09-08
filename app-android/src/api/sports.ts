import { apiFetch } from "./client";

export interface Sport {
  id: string;
  label: string;
  kind: "strength" | "endurance" | "wod" | "class" | "generic";
  color: string;
  gps: "sim" | "nao" | "opcional";
}

/** Catálogo de esportes (para o seletor de registro). */
export async function listSports(token: string): Promise<Sport[]> {
  const res = await apiFetch<{ data: Sport[] }>("/sports", { token });
  return res.data;
}
