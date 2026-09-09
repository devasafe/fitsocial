import { env } from "../../config/env.js";
import { AIError } from "./provider.js";

// Chamada HTTP para provedores de IA, com o que faltava: prazo para desistir e
// uma segunda chance quando a falha é passageira.
//
// Sem prazo, uma requisição fica pendurada até a outra ponta responder — foi
// assim que alguém esperou 88 segundos por uma mensagem de erro. E sem segunda
// chance, um 503 do free tier (que costuma passar em segundos) queima o elo
// inteiro da cadeia de fallback à toa.

export interface RespostaHttp {
  ok: boolean;
  status: number;
  corpo: unknown;
}

/** Vale tentar de novo na MESMA chave? Só quando o problema tende a passar. */
function passageiro(status: number): boolean {
  return status >= 500;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Faz a chamada respeitando o prazo, e repete quando o erro é passageiro.
 *
 * Quota (429) NÃO é repetida na mesma chave: limite diário não passa em três
 * segundos, então insistir só atrasa a troca para o próximo provedor.
 */
export async function chamarProvedor(
  url: string,
  init: RequestInit,
  nome: string
): Promise<RespostaHttp> {
  const tentativas = Math.max(env.aiRetries, 0) + 1;
  let ultimoErro: AIError | null = null;

  for (let i = 0; i < tentativas; i++) {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(env.aiTimeoutMs) });
    } catch (err) {
      const abortou = (err as Error).name === "TimeoutError" || (err as Error).name === "AbortError";

      if (abortou) {
        // Estourou o prazo: NÃO insiste aqui. Repetir gastaria outro prazo
        // inteiro na mesma chave que já se mostrou lenta, e somado passaria do
        // limite que o app aguenta. Cair para o próximo provedor é mais rápido
        // e é exatamente para isso que a cadeia existe.
        throw new AIError(`${nome} não respondeu em ${env.aiTimeoutMs / 1000}s`, true, "timeout");
      }

      ultimoErro = new AIError(
        `Falha de rede ao chamar ${nome}: ${(err as Error).message}`,
        true,
        "rede"
      );
      // Falha de rede costuma ser instantânea, então insistir é barato.
      if (i < tentativas - 1) {
        await espera(1500 * (i + 1));
        continue;
      }
      throw ultimoErro;
    }

    const corpo = await res.json().catch(() => ({}));

    if (!res.ok && passageiro(res.status) && i < tentativas - 1) {
      // Pausa antes de insistir: bater de novo na mesma hora costuma achar o
      // serviço no mesmo estado em que ele acabou de recusar.
      await espera(1500 * (i + 1));
      continue;
    }

    return { ok: res.ok, status: res.status, corpo };
  }

  throw ultimoErro ?? new AIError(`${nome} falhou`, true, "outro");
}
