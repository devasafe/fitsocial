import { AIError, type AIProvider, type GenerateOptions } from "./provider.js";

/**
 * Encadeia vários providers (chaves/serviços de IA). Tenta cada um em ordem;
 * se falhar de forma "retornável" (quota/429, 5xx, auth, rede), CAI PRA PRÓXIMA.
 * Se o erro não for de chave (conteúdo bloqueado), para na hora — trocar não ajuda.
 * Quantos providers você quiser: é só a ordem da lista.
 */
export class FallbackProvider implements AIProvider {
  readonly name: string;

  constructor(private readonly providers: AIProvider[]) {
    if (providers.length === 0) throw new AIError("Nenhum provider de IA configurado");
    this.name = `fallback(${providers.map((p) => p.name).join(" → ")})`;
  }

  async generate(options: GenerateOptions): Promise<string> {
    let lastError: unknown;
    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      try {
        return await provider.generate(options);
      } catch (err) {
        lastError = err;
        const retryable = err instanceof AIError ? err.retryable : true;
        const isLast = i === this.providers.length - 1;
        console.warn(
          `[ai] ${provider.name} falhou: ${(err as Error).message}.` +
            (retryable && !isLast ? " Caindo para o próximo…" : "")
        );
        if (!retryable) throw err; // não é problema de chave/quota — não adianta trocar
      }
    }
    throw lastError instanceof Error ? lastError : new AIError("Todos os providers de IA falharam");
  }
}
