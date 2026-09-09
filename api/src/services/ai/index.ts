import { z } from "zod";
import { env } from "../../config/env.js";
import { AIError, type AIProvider } from "./provider.js";
import { GeminiProvider } from "./gemini.js";
import { OpenAICompatibleProvider } from "./openaiCompatible.js";
import { FallbackProvider } from "./fallback.js";

let cached: AIProvider | null = null;

/** Monta a lista ordenada de providers a partir das chaves configuradas.
 *  Ordem: todas as chaves Gemini, depois Groq, depois OpenRouter. Cada chave é
 *  um provider — se uma estoura a quota, a cadeia cai pra próxima. */
function buildProviders(): AIProvider[] {
  const providers: AIProvider[] = [];
  for (const key of env.geminiApiKeys) providers.push(new GeminiProvider(key, env.geminiModel));
  for (const key of env.groqApiKeys) {
    providers.push(new OpenAICompatibleProvider("groq", "https://api.groq.com/openai/v1", key, env.groqModel));
  }
  for (const key of env.openrouterApiKeys) {
    providers.push(new OpenAICompatibleProvider("openrouter", "https://openrouter.ai/api/v1", key, env.openrouterModel));
  }
  return providers;
}

/** Retorna o provider de IA configurado (singleton). Uma chave = provider direto;
 *  várias = cadeia de fallback. */
export function getAIProvider(): AIProvider {
  if (cached) return cached;
  const providers = buildProviders();
  if (providers.length === 0) {
    throw new AIError(
      "Nenhuma chave de IA configurada. Defina GEMINI_API_KEY (ou GEMINI_API_KEYS / GROQ_API_KEYS / OPENROUTER_API_KEYS)."
    );
  }
  cached = providers.length === 1 ? providers[0] : new FallbackProvider(providers);
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
