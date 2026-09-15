import { createHash } from "node:crypto";
import { z } from "zod";
import { env } from "../../config/env.js";
import { AIError, type AIProvider, type GenerateOptions } from "./provider.js";
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
    // Só o CAMINHO e o CÓDIGO do campo entram na mensagem — nunca o valor. A
    // resposta pode ser a foto da janta de alguém ou uma conversa com o coach,
    // e isto vai para o log (ver middleware/error.ts).
    //
    // Sem isto ficávamos cegos: o log dizia apenas "não bateu com o formato
    // esperado", e descobrir que o culpado era uma observação longa demais
    // exigiu sondar o Gemini ao vivo com uma foto de verdade.
    const onde = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(raiz)"}:${i.code}`)
      .join(", ");
    throw new AIError(
      `A resposta da IA não bateu com o formato esperado (${onde})`,
      false,
      "formato"
    );
  }
  return result.data;
}

const TENTATIVAS = 2;

/** Abaixo dos 60s que o app espera, para o erro da IA chegar primeiro. */
const ORCAMENTO_PADRAO_MS = 50_000;

/**
 * Gera e valida numa tacada, com uma segunda chance quando a resposta vem
 * malformada.
 *
 * Por que aqui e não nas camadas que já repetem: `chamarProvedor` insiste
 * quando o HTTP falha, e o `FallbackProvider` troca de chave quando o provedor
 * recusa. Uma resposta 200 que não vira JSON escapa das duas — ela nasce depois
 * do HTTP e fora da cadeia. Era o único erro da camada de IA sem rede nenhuma,
 * e é acidente de geração: o modelo entra em loop de repetição e gruda pedaços
 * do fim da resposta. Trocar de chave não ajudaria; pedir de novo, sim.
 *
 * O chat do coach é a exceção e segue usando `parseJson` direto: ele já cai
 * para texto puro quando não vem JSON, e para isso precisa da resposta crua,
 * que este helper não devolve. Repetir ali também dobraria a espera de quem
 * está conversando, para recuperar um campo que o chat sabe viver sem.
 *
 * A segunda chance tem ORÇAMENTO, não só contador. O app desiste em 60s
 * (`app-android/src/api/client.ts`), e o servidor precisa errar antes dele para
 * que a mensagem específica da IA chegue no lugar da genérica de rede. Uma
 * rodada que já demorou não ganha repetição: o Express não cancela o handler
 * quando o cliente aborta, então a segunda chamada terminaria, acertaria,
 * debitaria cota do free tier — e o resultado seria jogado fora.
 */
export async function gerarEValidar<S extends z.ZodTypeAny>(
  provider: AIProvider,
  options: GenerateOptions,
  schema: S,
  opts: { orcamentoMs?: number } = {}
): Promise<z.infer<S>> {
  const orcamentoMs = opts.orcamentoMs ?? ORCAMENTO_PADRAO_MS;
  const inicio = Date.now();
  let ultimo: unknown;

  for (let i = 0; i < TENTATIVAS; i++) {
    const raw = await provider.generate(options);
    try {
      return parseJson(raw, schema);
    } catch (err) {
      // Só a falha de formato ganha segunda chance. Quota, timeout e conteúdo
      // bloqueado já são tratados nas camadas de baixo, cada um do seu jeito.
      if (!(err instanceof AIError) || err.kind !== "formato") throw err;
      ultimo = err;

      if (i < TENTATIVAS - 1) {
        // A próxima rodada tende a custar o mesmo que esta, e ela precisa caber
        // inteira no que sobrou. Estimar pelo medido é melhor que pelo teto do
        // provedor: o teto do `wod_import` é 45s, e usá-lo aqui mataria a
        // segunda chance mesmo nas leituras que respondem em 18s.
        const gasto = Date.now() - inicio;
        if (gasto * 2 > orcamentoMs) {
          console.warn(`[ai] resposta malformada em ${gasto}ms; sem prazo para pedir de novo.`);
          break;
        }
        console.warn(`[ai] resposta malformada: ${err.message}. Pedindo de novo…`);
      }
    }
  }

  throw ultimo;
}

export { AIError } from "./provider.js";
export type { AIProvider, AIMessage } from "./provider.js";
export { setAiTelemetrySink, reportAiCall } from "./telemetry.js";
export type { AiCallRecord, AiErrorKind, AiFeature, AiTelemetrySink } from "./telemetry.js";
