import { apiFetch } from "./client";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  tier: "free" | "premium";
  onboardingComplete: boolean;
}

interface AuthResponse {
  token: string;
  user: AppUser;
}

export function registerRequest(name: string, email: string, password: string) {
  return apiFetch<AuthResponse>("/auth/register", {
    method: "POST",
    body: { name, email, password },
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
