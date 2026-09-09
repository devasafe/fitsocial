import { AIError, type AIProvider, type GenerateOptions } from "./provider.js";
import {
  errorKindFromStatus,
  reportAiCall,
  type AiErrorKind,
  type AiProviderMeta,
} from "./telemetry.js";
import { chamarProvedor } from "./http.js";

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

    let resposta;
    try {
      resposta = await chamarProvedor(
        `${this.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            ...this.extraHeaders,
          },
          body: JSON.stringify(body),
        },
        this.name
      );
    } catch (err) {
      const kind = err instanceof AIError && err.kind === "timeout" ? "timeout" : "network";
      registrar(false, { errorKind: kind });
      throw err;
    }

    const data = resposta.corpo as ChatResponse;

    if (!resposta.ok) {
      const s = resposta.status;
      const retryable = s === 429 || s >= 500 || s === 401 || s === 403;
      registrar(false, { errorKind: errorKindFromStatus(s) });
      throw new AIError(
        data.error?.message ?? `${this.name} respondeu ${s}`,
        retryable,
        s === 429 ? "quota" : s >= 500 ? "indisponivel" : s === 401 || s === 403 ? "credencial" : "outro"
      );
    }

    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      registrar(false, { errorKind: "empty", usage: data.usage });
      throw new AIError(`Resposta vazia (${this.name})`, true, "vazio");
    }

    registrar(true, { usage: data.usage });
    return text;
  }
}
