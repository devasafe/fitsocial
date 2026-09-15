import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { z } from "zod";
import { GeminiProvider } from "./gemini.js";
import { OpenAICompatibleProvider } from "./openaiCompatible.js";
import { FallbackProvider } from "./fallback.js";
import { AIError, type AIProvider } from "./provider.js";
import { gerarEValidar, parseJson } from "./index.js";
import { setAiTelemetrySink, type AiCallRecord } from "./telemetry.js";

// O caminho feliz do free tier leva de 14 a 20 segundos, e às vezes o serviço
// devolve 5xx. Estes testes existem para que uma falha passageira não vire erro
// para quem está esperando um treino.

let registros: AiCallRecord[] = [];
const PEDIDO = { messages: [{ role: "user" as const, content: "oi" }] };

beforeEach(() => {
  registros = [];
  setAiTelemetrySink((r) => registros.push(r));
});

afterEach(() => {
  setAiTelemetrySink(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function respostaOk() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: "pronto" }] } }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 },
    }),
  } as unknown as Response;
}

function respostaErro(status: number) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { message: `falhou com ${status}` } }),
  } as unknown as Response;
}

describe("Falha passageira", () => {
  it("insiste na mesma chave quando vem 503, e entrega a resposta", async () => {
    const chamadas = [respostaErro(503), respostaOk()];
    let i = 0;
    vi.stubGlobal("fetch", vi.fn(async () => chamadas[i++]));

    const texto = await new GeminiProvider("k", "m").generate(PEDIDO);

    expect(texto).toBe("pronto");
    expect(i).toBe(2); // tentou duas vezes
    // Uma única chamada do ponto de vista de quem pediu: a retentativa é interna.
    expect(registros).toHaveLength(1);
    expect(registros[0].ok).toBe(true);
  });

  it("desiste depois das tentativas e deixa a cadeia cair para o próximo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respostaErro(503)));

    const p = new GeminiProvider("k", "m");
    await expect(p.generate(PEDIDO)).rejects.toMatchObject({ kind: "indisponivel", retryable: true });
  });

  it("NÃO insiste quando é quota: limite diário não passa em três segundos", async () => {
    const fetchFalso = vi.fn(async () => respostaErro(429));
    vi.stubGlobal("fetch", fetchFalso);

    await expect(new GeminiProvider("k", "m").generate(PEDIDO)).rejects.toMatchObject({
      kind: "quota",
    });
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("conteúdo bloqueado não é repetido nem troca de chave", async () => {
    const fetchFalso = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ promptFeedback: { blockReason: "SAFETY" } }),
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchFalso);

    const cadeia = new FallbackProvider([
      new GeminiProvider("k1", "m", { keyLabel: "gemini#1", chainIndex: 0 }),
      new GeminiProvider("k2", "m", { keyLabel: "gemini#2", chainIndex: 1 }),
    ]);

    await expect(cadeia.generate(PEDIDO)).rejects.toMatchObject({ kind: "bloqueado" });
    // Uma chamada só: insistir com outra chave daria o mesmo bloqueio.
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });
});

describe("Prazo de espera", () => {
  it("desiste quando o serviço não responde e marca como timeout", async () => {
    // Simula o que o AbortSignal faria: rejeita com TimeoutError.
    vi.stubGlobal("fetch", vi.fn(async () => {
      const e = new Error("The operation was aborted due to timeout");
      e.name = "TimeoutError";
      throw e;
    }));

    await expect(new GeminiProvider("k", "m").generate(PEDIDO)).rejects.toMatchObject({
      kind: "timeout",
      retryable: true,
    });
    expect(registros.at(-1)?.errorKind).toBe("timeout");
  });

  it("o pedido leva o sinal de prazo — sem ele a espera não teria fim", async () => {
    const fetchFalso = vi.fn(async (_url: string, _init?: RequestInit) => respostaOk());
    vi.stubGlobal("fetch", fetchFalso);

    await new GeminiProvider("k", "m").generate(PEDIDO);

    expect(fetchFalso.mock.calls[0][1]?.signal).toBeDefined();
  });
});

describe("Rede de segurança", () => {
  it("quando o Gemini some, o Groq responde e a pessoa não vê erro", async () => {
    let i = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      i++;
      // As duas primeiras são as tentativas do Gemini; a terceira é o Groq.
      if (i <= 2) return respostaErro(503);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "resposta do groq" } }],
          usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
        }),
      } as unknown as Response;
    }));

    const cadeia = new FallbackProvider([
      new GeminiProvider("k", "m", { keyLabel: "gemini#1", chainIndex: 0 }),
      new OpenAICompatibleProvider("groq", "https://x", "k2", "llama", {}, {
        keyLabel: "groq#1",
        chainIndex: 1,
      }),
    ]);

    const texto = await cadeia.generate(PEDIDO);

    expect(texto).toBe("resposta do groq");
    // A telemetria guarda os dois lados: quem falhou e quem salvou.
    expect(registros).toHaveLength(2);
    expect(registros[0]).toMatchObject({ keyLabel: "gemini#1", ok: false });
    expect(registros[1]).toMatchObject({ keyLabel: "groq#1", ok: true });
  });
});

describe("Trocar de provedor", () => {
  // Este caso escapou dos testes originais e só apareceu na verificação em
  // produção: modelo inexistente devolve 404, e a regra antiga só trocava de
  // provedor em 429/5xx/401/403. A cadeia parava no primeiro elo justamente
  // quando trocar resolveria — o Groq tem outro modelo.
  it("modelo inexistente (404) cai para o próximo em vez de virar erro", async () => {
    let i = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      i++;
      if (i === 1) return respostaErro(404);
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "salvo pelo groq" } }] }),
      } as unknown as Response;
    }));

    const cadeia = new FallbackProvider([
      new GeminiProvider("k", "modelo-que-nao-existe", { keyLabel: "gemini#1", chainIndex: 0 }),
      new OpenAICompatibleProvider("groq", "https://x", "k2", "m", {}, {
        keyLabel: "groq#1",
        chainIndex: 1,
      }),
    ]);

    await expect(cadeia.generate(PEDIDO)).resolves.toBe("salvo pelo groq");
  });

  it("manda teto de saída — sem ele o JSON do plano chega cortado", async () => {
    const fetchFalso = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "{}" } }] }),
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchFalso);

    await new OpenAICompatibleProvider("groq", "https://x", "k", "m").generate({
      ...PEDIDO,
      jsonMode: true,
    });

    const corpo = JSON.parse(String(fetchFalso.mock.calls[0][1]?.body));
    expect(corpo.max_completion_tokens).toBeGreaterThan(4000);
  });

  it("credencial inválida (401) também tenta o próximo", async () => {
    let i = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      i++;
      if (i === 1) return respostaErro(401);
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "ok" } }] }),
      } as unknown as Response;
    }));

    const cadeia = new FallbackProvider([
      new GeminiProvider("chave-ruim", "m", { keyLabel: "gemini#1", chainIndex: 0 }),
      new OpenAICompatibleProvider("groq", "https://x", "k2", "m", {}, {
        keyLabel: "groq#1",
        chainIndex: 1,
      }),
    ]);

    await expect(cadeia.generate(PEDIDO)).resolves.toBe("ok");
  });
});

describe("O que a pessoa lê", () => {
  it("nenhuma mensagem de erro entrega o provedor ou o status", async () => {
    const { errorHandler } = await import("../../middleware/error.js");

    for (const erro of [
      new AIError("Gemini respondeu 503", true, "indisponivel"),
      new AIError("o Gemini não respondeu em 45s", true, "timeout"),
      new AIError("quota exceeded for gemini-3.5-flash", true, "quota"),
      new AIError("Conteúdo bloqueado pelo Gemini: SAFETY", false, "bloqueado"),
    ]) {
      let corpo: { error?: string } = {};
      const res = {
        status: () => res,
        json: (b: { error?: string }) => { corpo = b; return res; },
      } as never;

      errorHandler(erro, {} as never, res, (() => {}) as never);

      expect(corpo.error).toBeTruthy();
      expect(corpo.error).not.toMatch(/gemini|groq|503|429|AIError/i);
    }
  });
});

describe("Resposta malformada", () => {
  // Uma resposta que não vira JSON válido é acidente de geração, não defeito da
  // chave: o modelo entra em loop de repetição e gruda pedaços do fim. Medido
  // contra o Gemini, aconteceu 1 vez em 5 respostas. Isso nascia FORA do
  // `chamarProvedor` e FORA do `FallbackProvider`, então não tinha segunda
  // chance nenhuma — uma única resposta torta virava erro para a pessoa.
  const schema = z.object({ itens: z.array(z.string()) });

  class ModeloDeRoteiro implements AIProvider {
    readonly name = "roteiro";
    readonly aceitaImagem = true;
    chamadas = 0;
    constructor(private readonly respostas: string[]) {}
    async generate(): Promise<string> {
      const r = this.respostas[Math.min(this.chamadas, this.respostas.length - 1)];
      this.chamadas++;
      return r;
    }
  }

  it("uma resposta corrompida ganha segunda chance, e a pessoa não vê erro", async () => {
    const modelo = new ModeloDeRoteiro([
      '{"itens":["arroz"' + 'de preparo."'.repeat(3),
      '{"itens":["arroz","feijao"]}',
    ]);

    const saida = await gerarEValidar(modelo, PEDIDO, schema);

    expect(saida.itens).toEqual(["arroz", "feijao"]);
    expect(modelo.chamadas).toBe(2);
  });

  it("desiste na segunda e não fica insistindo com o modelo", async () => {
    const modelo = new ModeloDeRoteiro(["nao sou json", "continuo nao sendo"]);

    await expect(gerarEValidar(modelo, PEDIDO, schema)).rejects.toMatchObject({
      name: "AIError",
      kind: "formato",
    });
    expect(modelo.chamadas).toBe(2);
  });

  it("não pede de novo quando a segunda rodada não caberia no prazo do app", async () => {
    // O app desiste em 60s (app-android/src/api/client.ts). Uma segunda rodada
    // que passe disso não entrega nada: o cliente já abortou, e o Express não
    // cancela o handler — a chamada termina, acerta, debita cota e o resultado
    // é jogado fora. Pior que o erro rápido e específico de antes.
    class ModeloLento implements AIProvider {
      readonly name = "lento";
      readonly aceitaImagem = false;
      chamadas = 0;
      async generate(): Promise<string> {
        this.chamadas++;
        await new Promise((r) => setTimeout(r, 40));
        return "nao sou json";
      }
    }
    const modelo = new ModeloLento();

    await expect(
      gerarEValidar(modelo, PEDIDO, schema, { orcamentoMs: 50 })
    ).rejects.toMatchObject({ kind: "formato" });

    expect(modelo.chamadas).toBe(1);
  });

  it("quota não ganha segunda chance — trocar de chave é trabalho da cadeia", async () => {
    // Guarda de regressão: o jeito fácil de estragar isto é afrouxar a checagem
    // de `kind` e passar a repetir quota, que é exatamente o erro que NÃO passa
    // em três segundos.
    class ModeloQueLanca implements AIProvider {
      readonly name = "recusa";
      readonly aceitaImagem = false;
      chamadas = 0;
      async generate(): Promise<string> {
        this.chamadas++;
        throw new AIError("limite diário", true, "quota");
      }
    }
    const modelo = new ModeloQueLanca();

    await expect(gerarEValidar(modelo, PEDIDO, schema)).rejects.toMatchObject({ kind: "quota" });
    expect(modelo.chamadas).toBe(1);
  });

  it("a frase cortada termina em palavra inteira, com reticências", async () => {
    // A tela mostra a observação inteira, sem numberOfLines (RefeicaoPorFoto).
    // Terminar em "...feito com óle" parece defeito do app, não escolha nossa.
    const { analiseDaFotoSchema } = await import("./refeicaoPorFoto.js");
    const frase = "Nao da para saber quanto de oleo foi usado no preparo do frango grelhado " +
      "e da farofa, e isso muda bastante o total de calorias do prato inteiro hoje servido aqui.";

    const saida = analiseDaFotoSchema.parse({ itens: [], observacao: frase.repeat(2) });

    expect(saida.observacao.length).toBeLessThanOrEqual(200);
    expect(saida.observacao).toMatch(/…$/);
    expect(saida.observacao).not.toMatch(/\s…$/);
  });

  it("o erro diz qual campo não bateu, para não depurar às cegas", async () => {
    // Sem isto o log dizia só "não bateu com o formato esperado". Descobrir que
    // o culpado era uma observação longa demais exigiu sondar o Gemini ao vivo.
    try {
      parseJson('{"itens":"arroz"}', schema);
      expect.unreachable("devia ter lançado");
    } catch (err) {
      expect((err as AIError).kind).toBe("formato");
      expect((err as Error).message).toMatch(/itens/);
    }
  });

  it("o campo com problema aparece no log, mas o conteúdo não", async () => {
    // Foto de refeição e conversa de coach são dado pessoal: o caminho do campo
    // serve para depurar, o valor dele não.
    try {
      parseJson('{"itens":"bife com farofa e uma anotacao intima"}', schema);
      expect.unreachable("devia ter lançado");
    } catch (err) {
      expect((err as Error).message).not.toMatch(/bife|farofa|intima/i);
    }
  });
});
