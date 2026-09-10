import { apiFetch } from "./client";

/** Cada chave liga um tipo de aviso. Tudo começa ligado: quem quer silêncio desliga. */
export interface PreferenciasDeNotificacao {
  novosPosts: boolean;
  interacoes: boolean;
  desafios: boolean;
  sistema: boolean;
}

/** De onde vem o treino: o plano do app, ou a programação do box/treinador. */
export type Programacao = "plano" | "propria";

export interface Settings {
  /** null = a pessoa ainda não respondeu; é o que dispara a pergunta. */
  activitiesPublic: boolean | null;
  routesPublic: boolean;
  /** null = ainda não escolheu; a Home mostra as opções. */
  programacao: Programacao | null;
  notificacoes: PreferenciasDeNotificacao;
}

/** O PATCH aceita mexer numa notificação sem mandar as outras. */
export type MudancaDeSettings = Partial<Omit<Settings, "notificacoes">> & {
  notificacoes?: Partial<PreferenciasDeNotificacao>;
};

export function getSettings(token: string) {
  return apiFetch<{ data: Settings }>("/auth/settings", { token });
}

export function updateSettings(token: string, mudancas: MudancaDeSettings) {
  return apiFetch<{ data: Settings }>("/auth/settings", {
    method: "PATCH",
    token,
    body: mudancas,
  });
}

/**
 * Trocar a senha derruba todas as sessões — inclusive a deste aparelho. Por isso
 * a resposta traz um token novo: quem está trocando continua dentro, e só os
 * outros aparelhos caem.
 */
export function alterarSenha(token: string, atual: string, nova: string) {
  return apiFetch<{ data: { token: string } }>("/auth/password", {
    method: "PATCH",
    token,
    body: { atual, nova },
  });
}
