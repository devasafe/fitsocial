import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export interface JwtPayload {
  sub: string; // id do usuário
  /** "admin" = sessão do painel. Ausente = token normal do app. */
  scope?: "admin";
  /** Versão da senha. Trocar a senha invalida os tokens emitidos antes. */
  v?: number;
}

/** Assina um token. Sem opções, é o token de 30 dias do app — como sempre foi. */
export function signToken(
  userId: string,
  opts: { scope?: "admin"; expiresIn?: string; tokenVersion?: number } = {}
): string {
  const payload: JwtPayload = {
    sub: userId,
    ...(opts.scope ? { scope: opts.scope } : {}),
    ...(opts.tokenVersion ? { v: opts.tokenVersion } : {}),
  };
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: (opts.expiresIn ?? env.jwtExpiresIn) as jwt.SignOptions["expiresIn"],
  });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret) as JwtPayload;
}
