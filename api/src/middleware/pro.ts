import type { Request, Response, NextFunction } from "express";
import { HttpError } from "../utils/httpError.js";
import { temCapacidade, type Capacidade } from "../services/entitlement.js";
import { env } from "../config/env.js";

/**
 * Exige que a pessoa tenha a capacidade profissional pedida.
 *
 * A capacidade é lida do DOCUMENTO, nunca do token. Dois motivos, e os dois já
 * custaram caro neste projeto:
 *
 * - `requireAuth` carrega o usuário fresco a cada requisição, então revogar o
 *   acesso de um coach tem efeito imediato — não espera token expirar.
 * - Pôr qualquer coisa nova no payload do JWT desloga quem já está dentro: os
 *   tokens valem 30 dias, não há refresh, e o app só troca de token em
 *   login/registro/troca de senha (ver `utils/token.ts`).
 *
 * Diferente do `requireAdmin`, aqui NÃO se exige `scope`. O painel profissional
 * emite sessão própria, mas o app também precisa saber que a pessoa é coach —
 * é o que mostra a entrada do painel e a lista de alunos dentro do aplicativo.
 * Exigir escopo aqui fecharia a porta do app junto com a do navegador.
 */
export function requirePro(...capacidades: Capacidade[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return next(new HttpError(401, "Token de autenticação ausente"));

    const pode = capacidades.some((c) => temCapacidade(user, c));
    if (!pode) {
      return next(
        new HttpError(403, `Esta conta não tem acesso profissional ao ${env.appName}. Fale com o suporte.`)
      );
    }
    next();
  };
}
