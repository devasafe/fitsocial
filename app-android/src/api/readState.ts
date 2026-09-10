import { apiFetch } from "./client";

/** As áreas que têm marca d'água própria. Notificação não entra: ela usa `read`. */
export type Area = "feed" | "explore" | "desafios";

export interface Contadores {
  feed: number;
  explore: number;
  desafios: number;
  notificacoes: number;
}

export const CONTADORES_ZERADOS: Contadores = {
  feed: 0,
  explore: 0,
  desafios: 0,
  notificacoes: 0,
};

export function getContadores(token: string) {
  return apiFetch<{ data: Contadores }>("/read-state", { token });
}

/** Devolve os contadores já atualizados — evita uma segunda ida ao servidor. */
export function marcarAreaVista(token: string, area: Area) {
  return apiFetch<{ data: Contadores }>(`/read-state/${area}`, { method: "POST", token });
}
