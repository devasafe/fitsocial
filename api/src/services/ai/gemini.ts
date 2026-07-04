import { env } from "../../config/env.js";
import { AIError, type AIProvider, type GenerateOptions } from "./provider.js";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiContent {
  role: "user" | "model";
  parts: { text: string }[];
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
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
    private readonly model = env.geminiModel
  ) {}

  async generate(options: GenerateOptions): Promise<string> {
    if (!this.apiKey) {
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
      throw new AIError(`Falha de rede ao chamar o Gemini: ${(err as Error).message}`);
    }

    const data = (await res.json().catch(() => ({}))) as GeminiResponse;

    if (!res.ok) {
      throw new AIError(data.error?.message ?? `Gemini respondeu ${res.status}`);
    }
    if (data.promptFeedback?.blockReason) {
      throw new AIError(`Conteúdo bloqueado pelo Gemini: ${data.promptFeedback.blockReason}`);
    }

    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!text) {
      throw new AIError("Resposta vazia do Gemini");
    }
    return text;
  }
}
