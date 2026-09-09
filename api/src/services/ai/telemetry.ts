// Telemetria da camada de IA. Os providers reportam aqui; quem persiste é
// injetado no boot (services/aiUsage.ts). Assim services/ai/ continua sem
// conhecer banco nem Express, como manda o CLAUDE.md.

/** De onde partiu a chamada — permite atribuir consumo por funcionalidade. */
export type AiFeature =
  | "coach"
  | "onboarding"
  | "plan_generate"
  | "plan_adjust"
  | "plan_import";

/** Motivo da falha, já classificado — o painel agrupa por isto. */
export type AiErrorKind = "quota" | "auth" | "server" | "network" | "blocked" | "empty" | "other";

/** Identifica a posição de um provider na cadeia de fallback. */
export interface AiProviderMeta {
  /** Rótulo estável da chave, ex.: "gemini#1". NUNCA a chave em si. */
  keyLabel: string;
  /** Posição na cadeia montada por buildProviders (0 = primeira tentativa). */
  chainIndex: number;
  /** Hash curto e irreversível da chave. O keyLabel é posicional: reordenar o
   *  CSV faz "gemini#1" virar outra chave e o histórico passa a mentir. Isto
   *  identifica a chave mesmo assim, sem guardar nada secreto. */
  keyFingerprint?: string;
}

export interface AiCallRecord extends AiProviderMeta {
  provider: string;
  model: string;
  feature?: AiFeature;
  userId?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  ok: boolean;
  errorKind?: AiErrorKind;
}

export type AiTelemetrySink = (record: AiCallRecord) => void;

let sink: AiTelemetrySink | null = null;

/** Registra quem persiste os registros. Sem sink, a telemetria é no-op —
 *  é o que mantém os testes e o dev local sem efeito colateral. */
export function setAiTelemetrySink(fn: AiTelemetrySink | null): void {
  sink = fn;
}

/** Reporta uma chamada de IA. Nunca lança: telemetria não pode derrubar a
 *  resposta que o usuário está esperando. */
export function reportAiCall(record: AiCallRecord): void {
  if (!sink) return;
  try {
    sink(record);
  } catch (err) {
    console.warn(`[ai] telemetria falhou: ${(err as Error).message}`);
  }
}

/** Traduz o status HTTP do provider no motivo que o painel agrupa. */
export function errorKindFromStatus(status: number): AiErrorKind {
  if (status === 429) return "quota";
  if (status === 401 || status === 403) return "auth";
  if (status >= 500) return "server";
  return "other";
}
