import { apiFetch } from "./client";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function getGreeting(token: string) {
  return apiFetch<{ greeting: string }>("/onboarding/greeting", { token });
}

export interface OnboardingReply {
  reply: string;
  complete: boolean;
  onboardingComplete: boolean;
}

export function sendOnboardingMessage(token: string, messages: ChatMessage[]) {
  return apiFetch<OnboardingReply>("/onboarding/message", {
    method: "POST",
    token,
    body: { messages },
  });
}

// Ficha estruturada preenchida por formulário (sem IA).
export interface ProfileForm {
  goal: "perder_gordura" | "ganhar_massa" | "saude_geral" | "performance";
  sex: "masculino" | "feminino" | "outro";
  age: number;
  heightCm: number;
  weightKg: number;
  experienceLevel: "iniciante" | "intermediario" | "avancado";
  daysPerWeek: number;
  sessionMinutes: number;
  dietaryRestrictions: string[];
  injuriesConditions: string[];
  notes: string;
}

export function submitProfile(token: string, profile: ProfileForm) {
  return apiFetch<{ onboardingComplete: boolean }>("/onboarding/profile", {
    method: "POST",
    token,
    body: profile,
  });
}
