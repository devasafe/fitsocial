import { apiFetch } from "./client";
import type { ChatMessage } from "./onboarding";

export function getCoachMessages(token: string) {
  return apiFetch<{ greeting: string; messages: ChatMessage[] }>("/coach/messages", { token });
}

export interface CoachReply {
  reply: string;
  planAdjusted: boolean;
  /** O coach concluiu que o plano precisa mudar. O ajuste em si é uma chamada
   *  separada — fazer as duas no mesmo pedido dobrava a espera. */
  adjustPending?: boolean;
  premiumRequired: boolean;
}

export function sendCoachMessage(token: string, content: string) {
  return apiFetch<CoachReply>("/coach/messages", {
    method: "POST",
    token,
    body: { content },
  });
}
