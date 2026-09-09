import { env } from "../../config/env.js";
import { AIError, type AIProvider, type GenerateOptions } from "./provider.js";
import {
  errorKindFromStatus,
  reportAiCall,
  type AiErrorKind,
  type AiProviderMeta,
} from "./telemetry.js";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiContent {
  role: "user" | "model";
  parts: { text: string }[];
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
  // Contagem de tokens que a API devolve em toda resposta bem-sucedida.
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

/**
 * Provider do Google Gemini via REST generateContent.
 * Usa responseMimeType=application/json no modo JSON (campo estável entre versões);
 * o schema em si é reforçado pelo prompt e validado com zod na camada de cima.
 */
export class GeminiProvider implements AIProvider {
  readonly name = "gemini";

  constructor(
    private readonly apiKey = env.geminiApiKey,
    private readonly model = env.geminiModel,
    private readonly meta: AiProviderMeta = { keyLabel: "gemini#1", chainIndex: 0 }
  ) {}

  async generate(options: GenerateOptions): Promise<string> {
    const iniciado = Date.now();

    // Registra a chamada para o painel. Falha aqui nunca afeta a resposta.
    const registrar = (
      ok: boolean,
      extra: { errorKind?: AiErrorKind; usage?: GeminiResponse["usageMetadata"] } = {}
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
        promptTokens: u?.promptTokenCount ?? 0,
        completionTokens: u?.candidatesTokenCount ?? 0,
        totalTokens: u?.totalTokenCount ?? 0,
        latencyMs: Date.now() - iniciado,
        ok,
        errorKind: extra.errorKind,
      });
    };

    if (!this.apiKey) {
      registrar(false, { errorKind: "auth" });
      throw new AIError("GEMINI_API_KEY não configurada no .env");
    }

    const contents: GeminiContent[] = options.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        ...(options.jsonMode ? { responseMimeType: "application/json" } : {}),
      },
    };
    if (options.system) {
      body.systemInstruction = { parts: [{ text: options.system }] };
    }

    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/${this.model}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      registrar(false, { errorKind: "network" });
      throw new AIError(`Falha de rede ao chamar o Gemini: ${(err as Error).message}`, true);
    }

    const data = (await res.json().catch(() => ({}))) as GeminiResponse;

    if (!res.ok) {
      // 429 (quota), 5xx (instabilidade), 401/403 (chave) → vale trocar de chave.
      const retryable = res.status === 429 || res.status >= 500 || res.status === 401 || res.status === 403;
      registrar(false, { errorKind: errorKindFromStatus(res.status) });
      throw new AIError(data.error?.message ?? `Gemini respondeu ${res.status}`, retryable);
    }
    if (data.promptFeedback?.blockReason) {
      // Bloqueio de conteúdo não muda por chave — não adianta cair pra próxima.
      registrar(false, { errorKind: "blocked", usage: data.usageMetadata });
      throw new AIError(`Conteúdo bloqueado pelo Gemini: ${data.promptFeedback.blockReason}`, false);
    }

    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!text) {
      registrar(false, { errorKind: "empty", usage: data.usageMetadata });
      throw new AIError("Resposta vazia do Gemini", true);
    }

    registrar(true, { usage: data.usageMetadata });
    return text;
  }
}
