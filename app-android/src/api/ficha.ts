import { apiFetch } from "./client";
import type { ProfileForm } from "./onboarding";

// A ficha é o mesmo formato de dados do onboarding — objetivo, dias por
// semana, restrições... — só que lida e editada depois, não só preenchida
// uma vez. `Partial` no PATCH porque a edição é campo a campo: mandar só o
// que mudou é o que garante que o resto sobrevive.
export type Ficha = ProfileForm;
export type FichaParcial = Partial<Ficha>;

export function getFicha(token: string) {
  return apiFetch<{ data: Ficha | null }>("/ficha", { token });
}

export function updateFicha(token: string, mudanca: FichaParcial) {
  return apiFetch<{ data: Ficha }>("/ficha", { method: "PATCH", token, body: mudanca });
}
