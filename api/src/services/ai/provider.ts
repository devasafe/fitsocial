// Contrato genérico da camada de IA. Nenhuma outra parte do sistema conhece
// qual LLM está por trás — trocar de provider é criar outra implementação desta
// interface e apontar o factory (services/ai/index.ts) para ela.

export interface AIMessage {
  role: "user" | "assistant";
  content: string;
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
}

export interface AIProvider {
  /** Nome do provider (para logs/diagnóstico). */
  readonly name: string;
  /** Gera texto a partir do histórico. Retorna o texto bruto da resposta. */
  generate(options: GenerateOptions): Promise<string>;
}

/** Erro específico da camada de IA, para o middleware tratar de forma amigável. */
export class AIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIError";
  }
}
