import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export interface JwtPayload {
  sub: string; // id do usuário
  /** "admin" = sessão do painel. Ausente = token normal do app. */
  scope?: "admin";
  /** Versão da senha. Trocar a senha invalida os tokens emitidos antes. */
  v?: number;
}

/**
 * Assina um token PARA UM USUÁRIO — sempre carregando a versão da senha dele.
 *
 * Existe porque a alternativa não funcionou: com `tokenVersion` opcional em
 * `signToken`, a rota de sessão do painel esqueceu de passá-lo, e o token
 * nascia com `v` ausente. Enquanto a versão de todo mundo era 0 ninguém notou;
 * na primeira troca de senha, o painel passou a emitir tokens natimortos — o
 * login respondia 200 e a requisição seguinte, 401, para sempre.
 *
 * Aqui o valor vem do próprio usuário, então não há o que esquecer nem o que
 * passar errado. Todo emissor de token deve usar esta função.
 */
export function signTokenForUser(
  user: { _id: { toString(): string }; tokenVersion?: number | null },
  opts: { scope?: "admin"; expiresIn?: string } = {}
): string {
  return signToken(user._id.toString(), { ...opts, tokenVersion: user.tokenVersion ?? 0 });
}

/** Assinatura crua. Prefira `signTokenForUser` — ver o porquê acima. */
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
