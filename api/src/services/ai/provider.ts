import type { AiFeature } from "./telemetry.js";

// Contrato genérico da camada de IA. Nenhuma outra parte do sistema conhece
// qual LLM está por trás — trocar de provider é criar outra implementação desta
// interface e apontar o factory (services/ai/index.ts) para ela.

export interface AIMessage {
  role: "user" | "assistant";
  content: string;
}

/** Uma imagem enviada junto do texto, para os modelos que enxergam. */
export interface AIImage {
  /** Bytes da imagem em base64, SEM o prefixo "data:". */
  base64: string;
  mimeType: string;
}

export interface GenerateOptions {
  /** Instrução de sistema (persona, regras, formato de saída). */
  system?: string;
  /** Histórico da conversa. */
  messages: AIMessage[];
  /** Se true, pede ao modelo que responda em JSON puro. */
  jsonMode?: boolean;
  /** 0 = determinístico; ~0.7 = mais criativo. */
  temperature?: number;
  /** Funcionalidade que originou a chamada — só para telemetria. */
  feature?: AiFeature;
  /** Quem disparou a chamada — só para telemetria. */
  userId?: string;
  /** Imagem para o modelo analisar. Só providers com `aceitaImagem`. */
  imagem?: AIImage;
  /** Prazo próprio, para chamadas que geram muita saída. Padrão: env. */
  timeoutMs?: number;
}

export interface AIProvider {
  /** Nome do provider (para logs/diagnóstico). */
  readonly name: string;
  /** Este modelo enxerga imagem? Quem não enxerga é pulado na cadeia quando a
   *  chamada tem foto — mandar mesmo assim renderia uma resposta inventada
   *  sobre um prato que o modelo nunca viu. */
  readonly aceitaImagem: boolean;
  /** Gera texto a partir do histórico. Retorna o texto bruto da resposta. */
  generate(options: GenerateOptions): Promise<string>;
}

/** O que deu errado, em termos que a borda consegue traduzir para o usuário.
 *  A mensagem crua ("Gemini respondeu 503") serve para o log e para o painel,
 *  nunca para quem está tentando montar um treino. */
export type AIErrorKind =
  | "timeout"
  | "quota"
  | "indisponivel"
  | "credencial"
  | "bloqueado"
  | "rede"
  | "vazio"
  | "formato"
  | "outro";

/** Erro específico da camada de IA, para o middleware tratar de forma amigável.
 *  `retryable` = true quando trocar de chave/provider pode resolver (quota/429,
 *  5xx, auth, rede). false quando não adianta (conteúdo bloqueado, JSON inválido). */
export class AIError extends Error {
  readonly retryable: boolean;
  readonly kind: AIErrorKind;
  constructor(message: string, retryable = false, kind: AIErrorKind = "outro") {
    super(message);
    this.name = "AIError";
    this.retryable = retryable;
    this.kind = kind;
  }
}
