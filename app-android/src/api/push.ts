import { apiFetch } from "./client";

export type Plataforma = "ios" | "android";

export function registrarAparelho(authToken: string, token: string, platform: Plataforma) {
  return apiFetch<{ data: { registrado: boolean } }>("/push/devices", {
    method: "POST",
    token: authToken,
    body: { token, platform },
  });
}

export function removerAparelho(authToken: string, token: string) {
  return apiFetch<{ data: { removido: boolean } }>("/push/devices", {
    method: "DELETE",
    token: authToken,
    body: { token },
  });
}
