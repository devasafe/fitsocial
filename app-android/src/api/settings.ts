import { apiFetch } from "./client";

export interface Settings {
  /** null = a pessoa ainda não respondeu; é o que dispara a pergunta. */
  activitiesPublic: boolean | null;
  routesPublic: boolean;
}

export function getSettings(token: string) {
  return apiFetch<{ data: Settings }>("/auth/settings", { token });
}

export function updateSettings(token: string, mudancas: Partial<Settings>) {
  return apiFetch<{ data: Settings }>("/auth/settings", {
    method: "PATCH",
    token,
    body: mudancas,
  });
}
