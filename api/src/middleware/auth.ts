import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/token.js";
import { User, type UserDoc } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";
import { assertAccountUsable } from "../services/moderation.js";
import { marcarPresenca } from "../services/presence.js";

// Anexa o usuário autenticado ao request.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserDoc;
      /** Escopo do token apresentado ("admin" só em sessão do painel). */
      tokenScope?: string;
    }
  }
}

/** Exige um Bearer token válido e carrega o usuário no request. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) {
      throw new HttpError(401, "Token de autenticação ausente");
    }

    const payload = verifyToken(token);
    const user = await User.findById(payload.sub);
    if (!user) {
      throw new HttpError(401, "Usuário não encontrado");
    }

    // Trocar a senha derruba as sessões antigas.
    //
    // O `?? 0` não é detalhe: tokens emitidos antes deste campo existir não
    // trazem `v`, e o default de tokenVersion é 0. Sem isso, subir esta versão
    // deslogaria todo mundo que já estava usando o app.
    if ((payload.v ?? 0) !== (user.tokenVersion ?? 0)) {
      throw new HttpError(401, "Sua senha mudou. Entre de novo.");
    }

    // Banimento e suspensão valem para tokens JÁ emitidos: o usuário é lido do
    // banco a cada requisição, então o corte é imediato.
    await assertAccountUsable(user);

    // Registra o acesso sem bloquear: é métrica, não regra de negócio. A
    // pessoa está esperando a resposta dela, não a nossa estatística.
    void marcarPresenca(user);

    req.user = user;
    req.tokenScope = payload.scope;
    next();
  } catch (err) {
    // HttpError aqui já traz a mensagem certa (banida, suspensa até tal dia).
    // Engolir em um 401 genérico deixaria a pessoa sem saber o que aconteceu.
    if (err instanceof HttpError) return next(err);
    next(new HttpError(401, "Token inválido ou expirado"));
  }
}

/** Exige que o usuário autenticado seja premium (gating do freemium — Fatia 5). */
export function requirePremium(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.tier !== "premium") {
    return next(new HttpError(403, "Recurso disponível apenas no plano premium"));
  }
  next();
}
