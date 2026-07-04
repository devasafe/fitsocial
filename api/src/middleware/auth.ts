import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/token.js";
import { User, type UserDoc } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";

// Anexa o usuário autenticado ao request.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserDoc;
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

    req.user = user;
    next();
  } catch (err) {
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
