import { z } from "zod";
import { env } from "../../config/env.js";
import { AIError, type AIProvider } from "./provider.js";
import { GeminiProvider } from "./gemini.js";

let cached: AIProvider | null = null;

/** Retorna o provider de IA configurado (singleton). Troque aqui para trocar de LLM. */
export function getAIProvider(): AIProvider {
  if (cached) return cached;
  switch (env.aiProvider) {
    case "gemini":
      cached = new GeminiProvider();
      break;
    default:
      throw new AIError(`Provider de IA desconhecido: ${env.aiProvider}`);
  }
  return cached;
}

/** Permite injetar um provider (ex.: mock nos testes). */
export function setAIProvider(provider: AIProvider | null): void {
  cached = provider;
}

/**
 * Extrai JSON de uma resposta de LLM (removendo cercas ```json se houver) e
 * valida contra um schema zod. Lança AIError com mensagem clara se falhar.
 */
export function parseJson<S extends z.ZodTypeAny>(raw: string, schema: S): z.infer<S> {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new AIError("A IA não retornou um JSON válido");
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new AIError("A resposta da IA não bateu com o formato esperado");
  }
  return result.data;
}

export { AIError } from "./provider.js";
export type { AIProvider, AIMessage } from "./provider.js";
