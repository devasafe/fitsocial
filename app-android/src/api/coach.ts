import { apiFetch } from "./client";
import type { ChatMessage } from "./onboarding";

export function getCoachMessages(token: string) {
  return apiFetch<{ greeting: string; messages: ChatMessage[] }>("/coach/messages", { token });
}

export interface CoachReply {
  reply: string;
  planAdjusted: boolean;
  premiumRequired: boolean;
}

export function sendCoachMessage(token: string, content: string) {
  return apiFetch<CoachReply>("/coach/messages", {
    method: "POST",
    token,
    body: { content },
  });
}
