import { AIError, type AIProvider, type GenerateOptions } from "./provider.js";
import {
  errorKindFromStatus,
  reportAiCall,
  type AiErrorKind,
  type AiProviderMeta,
} from "./telemetry.js";

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
  // Contagem de tokens no formato OpenAI, devolvida por Groq e OpenRouter.
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Provider genérico para APIs no formato OpenAI Chat Completions — cobre vários
 * serviços grátis (Groq, OpenRouter, Together, etc.) só mudando baseUrl/model.
 * Entra na cadeia de fallback junto do Gemini.
 */
export class OpenAICompatibleProvider implements AIProvider {
  constructor(
    readonly name: string,
    private readonly baseUrl: string, // ex.: https://api.groq.com/openai/v1
    private readonly apiKey: string,
    private readonly model: string,
    private readonly extraHeaders: Record<string, string> = {},
    private readonly meta: AiProviderMeta = { keyLabel: "openai#1", chainIndex: 0 }
  ) {}

  async generate(options: GenerateOptions): Promise<string> {
    const iniciado = Date.now();

    const registrar = (
      ok: boolean,
      extra: { errorKind?: AiErrorKind; usage?: ChatResponse["usage"] } = {}
    ) => {
      const u = extra.usage;
      reportAiCall({
        provider: this.name,
        model: this.model,
        keyLabel: this.meta.keyLabel,
        chainIndex: this.meta.chainIndex,
        keyFingerprint: this.meta.keyFingerprint,
        feature: options.feature,
        userId: options.userId,
        promptTokens: u?.prompt_tokens ?? 0,
        completionTokens: u?.completion_tokens ?? 0,
        totalTokens: u?.total_tokens ?? 0,
        latencyMs: Date.now() - iniciado,
        ok,
        errorKind: extra.errorKind,
      });
    };

    if (!this.apiKey) {
      registrar(false, { errorKind: "auth" });
      throw new AIError(`Chave ausente para ${this.name}`, false);
    }

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [];
    if (options.system) messages.push({ role: "system", content: options.system });
    for (const m of options.messages) {
      messages.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.content });
    }

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: options.temperature ?? 0.7,
      ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...this.extraHeaders,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      registrar(false, { errorKind: "network" });
      throw new AIError(`Falha de rede (${this.name}): ${(err as Error).message}`, true);
    }

    const data = (await res.json().catch(() => ({}))) as ChatResponse;

    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500 || res.status === 401 || res.status === 403;
      registrar(false, { errorKind: errorKindFromStatus(res.status) });
      throw new AIError(data.error?.message ?? `${this.name} respondeu ${res.status}`, retryable);
    }

    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      registrar(false, { errorKind: "empty", usage: data.usage });
      throw new AIError(`Resposta vazia (${this.name})`, true);
    }

    registrar(true, { usage: data.usage });
    return text;
  }
}
