import type { Request, Response, NextFunction } from "express";
import { HttpError } from "../utils/httpError.js";

/**
 * Exige que o usuário seja admin E que o token seja de sessão do painel.
 *
 * As duas checagens são complementares e nenhuma substitui a outra:
 *
 * - `role` vem do documento fresco do banco (requireAuth faz findById a cada
 *   requisição), então revogar o papel tem efeito imediato, sem esperar o token
 *   expirar.
 * - `scope` impede que o token de 30 dias do app — inclusive o do próprio dono,
 *   guardado no celular dele — sirva para operar o painel. Perder o telefone
 *   deixa de significar perder o painel.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") {
    return next(new HttpError(403, "Acesso restrito à administração"));
  }
  if (req.tokenScope !== "admin") {
    return next(new HttpError(403, "Esta sessão não vale para o painel. Entre pelo painel administrativo."));
  }
  next();
}
