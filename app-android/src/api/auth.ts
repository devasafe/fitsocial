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
