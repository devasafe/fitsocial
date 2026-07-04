import { apiFetch } from "./client";
import type { AppUser } from "./auth";

/**
 * Upgrade de DESENVOLVIMENTO (alterna free/premium) — só funciona fora de
 * produção. Em produção, a assinatura real acontece via RevenueCat/Play Billing.
 */
export function devUpgrade(token: string) {
  return apiFetch<{ user: AppUser }>("/billing/dev-upgrade", {
    method: "POST",
    token,
  });
}
