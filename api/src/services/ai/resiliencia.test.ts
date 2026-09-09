import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GeminiProvider } from "./gemini.js";
import { OpenAICompatibleProvider } from "./openaiCompatible.js";
import { FallbackProvider } from "./fallback.js";
import { AIError } from "./provider.js";
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
