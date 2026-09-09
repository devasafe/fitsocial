import { createHash } from "node:crypto";
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

  // keyLabel identifica a chave no painel pela POSIÇÃO na env (gemini#1, gemini#2…).
  // Nunca guardamos a chave em si — o SECURITY.md proíbe segredo em log.
  const rotulo = (servico: string, i: number, key: string) => ({
    keyLabel: `${servico}#${i + 1}`,
    chainIndex: providers.length,
    keyFingerprint: createHash("sha256").update(key).digest("hex").slice(0, 8),
  });

  env.geminiApiKeys.forEach((key, i) => {
    providers.push(new GeminiProvider(key, env.geminiModel, rotulo("gemini", i, key)));
  });
  env.groqApiKeys.forEach((key, i) => {
    providers.push(
      new OpenAICompatibleProvider("groq", "https://api.groq.com/openai/v1", key, env.groqModel, {}, rotulo("groq", i, key))
    );
  });
  env.openrouterApiKeys.forEach((key, i) => {
    providers.push(
      new OpenAICompatibleProvider("openrouter", "https://openrouter.ai/api/v1", key, env.openrouterModel, {}, rotulo("openrouter", i, key))
    );
  });
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
    throw new AIError("A IA não retornou um JSON válido", false, "formato");
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new AIError("A resposta da IA não bateu com o formato esperado", false, "formato");
  }
  return result.data;
}

export { AIError } from "./provider.js";
export type { AIProvider, AIMessage } from "./provider.js";
export { setAiTelemetrySink, reportAiCall } from "./telemetry.js";
export type { AiCallRecord, AiErrorKind, AiFeature, AiTelemetrySink } from "./telemetry.js";
