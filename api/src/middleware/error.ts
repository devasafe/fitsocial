import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { HttpError } from "../utils/httpError.js";
import { AIError, type AIErrorKind } from "../services/ai/provider.js";

/** O que a pessoa lê quando a IA falha. Cada mensagem diz o que houve em termos
 *  de produto e o que fazer a seguir — nunca o nome do provedor nem o status. */
const MENSAGENS: Record<AIErrorKind, string> = {
  timeout: "A IA está demorando mais que o normal. Tente de novo em alguns instantes.",
  indisponivel: "A IA está fora do ar no momento. Tente de novo em alguns instantes.",
  rede: "Não consegui falar com a IA agora. Verifique sua conexão e tente de novo.",
  quota: "O limite de uso da IA foi atingido por hoje. Tente novamente amanhã.",
  credencial: "A IA está com problema de configuração. Já estamos vendo isso.",
  bloqueado: "Não consegui responder a essa mensagem. Tente escrever de outro jeito.",
  vazio: "A IA não conseguiu responder dessa vez. Tente de novo.",
  formato: "A IA respondeu num formato inesperado. Tente de novo.",
  outro: "A IA não está disponível agora. Tente de novo em alguns instantes.",
};

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
    // O detalhe técnico fica no log e na telemetria, que é onde ele serve.
    // "Gemini respondeu 503" não ajuda quem está tentando montar um treino, e
    // ainda entrega qual provedor está por trás.
    console.error(`[ai] Falha na camada de IA (${err.kind}):`, err.message);
    return res.status(502).json({ error: MENSAGENS[err.kind] ?? MENSAGENS.outro });
  }

  console.error("[error] Erro não tratado:", err);
  return res.status(500).json({ error: "Erro interno do servidor" });
}
