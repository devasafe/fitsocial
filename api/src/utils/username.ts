import { z } from "zod";

/** Normaliza um username para armazenamento/comparação: apara e minúsculas. */
export function normalizeUsername(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Regras do @username: 3–20 chars, apenas [a-z0-9._], sem ponto no início/fim
 * e sem dois pontos seguidos. (Aplique normalizeUsername antes de validar.)
 */
export const usernameSchema = z
  .string()
  .min(3, "Mínimo de 3 caracteres")
  .max(20, "Máximo de 20 caracteres")
  .regex(/^[a-z0-9._]+$/, "Use apenas letras minúsculas, números, ponto e sublinhado")
  .refine((s) => !s.startsWith(".") && !s.endsWith("."), "Não pode começar nem terminar com ponto")
  .refine((s) => !s.includes(".."), "Não use dois pontos seguidos");
