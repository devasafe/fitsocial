import { env } from "../../config/env.js";
import { AIError, type AIProvider, type GenerateOptions } from "./provider.js";
import {
  errorKindFromStatus,
  reportAiCall,
  type AiErrorKind,
  type AiProviderMeta,
} from "./telemetry.js";
import { chamarProvedor } from "./http.js";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/** Uma part e texto OU imagem embutida. O corpo aceita as duas na mesma
 *  mensagem, que e como se manda uma foto com a pergunta junto. */
type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
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
  // A familia Flash e multimodal: aceita imagem na mesma chamada.
  readonly aceitaImagem = true;

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

    // A imagem vai na ULTIMA mensagem do usuario, antes do texto: e a ordem que
    // o Gemini documenta para "olhe isto e responda aquilo".
    if (options.imagem) {
      const ultima = contents[contents.length - 1];
      if (!ultima || ultima.role !== "user") {
        throw new AIError("Imagem sem uma pergunta de usuario para acompanhar");
      }
      ultima.parts.unshift({
        inlineData: { mimeType: options.imagem.mimeType, data: options.imagem.base64 },
      });
    }

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

    // O helper cuida do prazo e de insistir quando a falha é passageira.
    let resposta;
    try {
      resposta = await chamarProvedor(
        `${BASE_URL}/${this.model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          body: JSON.stringify(body),
        },
        "o Gemini"
      );
    } catch (err) {
      const kind = err instanceof AIError && err.kind === "timeout" ? "timeout" : "network";
      registrar(false, { errorKind: kind });
      throw err;
    }

    const data = resposta.corpo as GeminiResponse;

    if (!resposta.ok) {
      // Qualquer recusa do provedor justifica tentar o próximo da cadeia: quota,
      // instabilidade, credencial e até modelo inexistente (404) mudam de um
      // provedor para outro. Só o bloqueio de conteúdo, tratado abaixo, daria o
      // mesmo resultado em todos — e por isso é o único que interrompe.
      const s = resposta.status;
      const retryable = true;
      registrar(false, { errorKind: errorKindFromStatus(s) });
      throw new AIError(
        data.error?.message ?? `Gemini respondeu ${s}`,
        retryable,
        s === 429 ? "quota" : s >= 500 ? "indisponivel" : s === 401 || s === 403 ? "credencial" : "outro"
      );
    }
    if (data.promptFeedback?.blockReason) {
      // Bloqueio de conteúdo não muda por chave — não adianta cair pra próxima.
      registrar(false, { errorKind: "blocked", usage: data.usageMetadata });
      throw new AIError(
        `Conteúdo bloqueado pelo Gemini: ${data.promptFeedback.blockReason}`,
        false,
        "bloqueado"
      );
    }

    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!text) {
      registrar(false, { errorKind: "empty", usage: data.usageMetadata });
      throw new AIError("Resposta vazia do Gemini", true, "vazio");
    }

    registrar(true, { usage: data.usageMetadata });
    return text;
  }
}
