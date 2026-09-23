import { apiFetch } from "./client";

/**
 * Os nomes precisam bater com `EVENTOS_CONHECIDOS` em `api/src/models/AppEvent.ts`.
 * O servidor IGNORA o que não conhece, então um nome novo aqui não quebra nada —
 * ele simplesmente não é gravado até a API subir.
 */
export type NomeDeEvento =
  | "onboarding_abriu"
  | "onboarding_saiu"
  | "onboarding_concluiu"
  | "home_viu"
  | "registrar_abriu"
  | "registrar_esporte"
  | "treino_salvo"
  | "concluido_viu"
  | "compartilhar_tocou"
  | "card_gerado"
  | "story_abriu";

/** Dimensão de análise, nunca conteúdo escrito pela pessoa. */
export type PropsDeEvento = Record<string, string | number | boolean>;

export interface EventoEnviado {
  nome: NomeDeEvento;
  props?: PropsDeEvento;
}

export function enviarEventos(token: string, eventos: EventoEnviado[]) {
  return apiFetch<{ data: { aceitos: number; ignorados: number } }>("/events", {
    method: "POST",
    token,
    body: { eventos },
  });
}
