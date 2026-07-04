import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { HttpError } from "../utils/httpError.js";
import { AIError } from "../services/ai/provider.js";

/** Middleware central: converte erros conhecidos em respostas JSON consistentes. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Dados inválidos",
      details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }

  if (err instanceof AIError) {
    console.error("[ai] Falha na camada de IA:", err.message);
    return res.status(502).json({ error: `Coach indisponível no momento: ${err.message}` });
  }

  console.error("[error] Erro não tratado:", err);
  return res.status(500).json({ error: "Erro interno do servidor" });
}
