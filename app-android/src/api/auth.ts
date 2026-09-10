import { apiFetch } from "./client";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  username: string | null;
  avatarUrl: string;
  bio: string;
  tier: "free" | "premium";
  onboardingComplete: boolean;
  // Amigo fundador (premium de presente) + mensagem pessoal, quando aplicável.
  isFounder?: boolean;
  founderMessage?: string | null;
  settings?: {
    /** null = ainda não respondeu; é o que dispara a pergunta pós-treino. */
    activitiesPublic: boolean | null;
    routesPublic: boolean;
    /** De onde vem o treino. null = ainda não escolheu. */
    programacao?: "plano" | "propria" | null;
  };
}

interface AuthResponse {
  token: string;
  user: AppUser;
}

export function registerRequest(name: string, email: string, password: string, username?: string) {
  return apiFetch<AuthResponse>("/auth/register", {
    method: "POST",
    body: { name, email, password, ...(username ? { username } : {}) },
  });
}

export function loginRequest(email: string, password: string) {
  return apiFetch<AuthResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
  });
}

export function meRequest(token: string) {
  return apiFetch<{ user: AppUser }>("/auth/me", { token });
}

export function updateMe(token: string, patch: { username?: string; name?: string; bio?: string; avatarUrl?: string }) {
  return apiFetch<{ user: AppUser }>("/auth/me", { method: "PATCH", token, body: patch });
}

export function checkUsername(token: string, username: string) {
  return apiFetch<{ available: boolean }>(`/auth/check-username?username=${encodeURIComponent(username)}`, { token });
}

/**
 * Exclusão definitiva da conta (LGPD). Não existe desativar: o que volta é uma
 * conta nova, do zero, com o mesmo e-mail.
 */
export function excluirConta(token: string, senha: string) {
  return apiFetch<{ data: { excluida: boolean } }>("/auth/me", {
    method: "DELETE",
    token,
    body: { senha },
  });
}

/**
 * Pede o código para criar uma senha nova.
 *
 * A resposta é a mesma exista o e-mail ou não — a tela não tem como saber, e
 * isso é de propósito: descobrir quem tem conta não pode ser de graça.
 */
export function pedirCodigoDeSenha(email: string) {
  return apiFetch<{ data: { enviado: boolean }; meta: { mensagem: string } }>(
    "/auth/forgot-password",
    { method: "POST", body: { email } }
  );
}

/** Conclui a redefinição e já devolve a sessão. */
export function redefinirSenhaComCodigo(email: string, codigo: string, nova: string) {
  return apiFetch<{ data: { token: string; user: AppUser } }>("/auth/reset-password", {
    method: "POST",
    body: { email, codigo, nova },
  });
}
