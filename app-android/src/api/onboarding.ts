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
