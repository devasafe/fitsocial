import type { Request, Response, NextFunction } from "express";
import { HttpError } from "../utils/httpError.js";

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Rate limiter simples em memória (janela fixa), por usuário autenticado (ou IP).
 * Protege os endpoints de IA contra abuso e estouro de custo de tokens.
 * Para múltiplas instâncias, trocar por um store compartilhado (ex.: Redis).
 */
export function rateLimit(opts: { windowMs: number; max: number; name: string }) {
  const buckets = new Map<string, Bucket>();

  return (req: Request, _res: Response, next: NextFunction) => {
    const id = req.user?._id?.toString() ?? req.ip ?? "anon";
    const key = `${opts.name}:${id}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    if (bucket.count > opts.max) {
      return next(
        new HttpError(429, "Muitas solicitações em pouco tempo. Aguarde um instante e tente de novo.")
      );
    }
    next();
  };
}
