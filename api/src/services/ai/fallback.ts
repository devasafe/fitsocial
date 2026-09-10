import { AIError, type AIProvider, type GenerateOptions } from "./provider.js";

/**
 * Encadeia vários providers (chaves/serviços de IA). Tenta cada um em ordem;
 * se falhar de forma "retornável" (quota/429, 5xx, auth, rede), CAI PRA PRÓXIMA.
 * Se o erro não for de chave (conteúdo bloqueado), para na hora — trocar não ajuda.
 * Quantos providers você quiser: é só a ordem da lista.
 */
export class FallbackProvider implements AIProvider {
  readonly name: string;
  readonly aceitaImagem: boolean;

  constructor(private readonly providers: AIProvider[]) {
    if (providers.length === 0) throw new AIError("Nenhum provider de IA configurado");
    this.name = `fallback(${providers.map((p) => p.name).join(" → ")})`;
    // A cadeia enxerga se ALGUÉM nela enxerga.
    this.aceitaImagem = providers.some((p) => p.aceitaImagem);
  }

  async generate(options: GenerateOptions): Promise<string> {
    // Com imagem, só entram os que enxergam. Mandar uma foto para um modelo de
    // texto não dá erro: dá uma resposta confiante sobre um prato que ele nunca
    // viu, e a pessoa registra macros inventados no diário dela.
    const elegiveis = options.imagem
      ? this.providers.filter((p) => p.aceitaImagem)
      : this.providers;

    if (elegiveis.length === 0) {
      throw new AIError("Nenhum modelo configurado analisa imagem", false, "credencial");
    }

    let lastError: unknown;
    for (let i = 0; i < elegiveis.length; i++) {
      const provider = elegiveis[i];
      try {
        return await provider.generate(options);
      } catch (err) {
        lastError = err;
        const retryable = err instanceof AIError ? err.retryable : true;
        const isLast = i === elegiveis.length - 1;
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
