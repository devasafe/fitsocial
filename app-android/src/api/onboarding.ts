import { apiFetch } from "./client";

// Mantido: usado pelo chat do coach (CoachScreen/CoachSheet), não pelo onboarding.
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
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
