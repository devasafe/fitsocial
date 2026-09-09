import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GeminiProvider } from "./gemini.js";
import { OpenAICompatibleProvider } from "./openaiCompatible.js";
import { FallbackProvider } from "./fallback.js";
import { setAiTelemetrySink, type AiCallRecord } from "./telemetry.js";

const CHAVE = "chave-secreta-do-gemini-nao-pode-vazar";

let registros: AiCallRecord[] = [];

beforeEach(() => {
  registros = [];
  setAiTelemetrySink((r) => registros.push(r));
});

afterEach(() => {
  setAiTelemetrySink(null);
  vi.unstubAllGlobals();
});

/** Resposta de sucesso do Gemini, com a contagem de tokens que a API devolve. */
function respostaOk(atrasoMs = 0) {
  return vi.fn(async () => {
    if (atrasoMs) await new Promise((r) => setTimeout(r, atrasoMs));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "oi" }] } }],
        usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, totalTokenCount: 150 },
      }),
    } as unknown as Response;
  });
}

function respostaErro(status: number) {
  return vi.fn(async () => ({
    ok: false,
    status,
    json: async () => ({ error: { message: `falhou com ${status}` } }),
  }) as unknown as Response);
}

describe("Telemetria da IA", () => {
  it("captura os tokens que o Gemini devolve", async () => {
    vi.stubGlobal("fetch", respostaOk());
    const p = new GeminiProvider(CHAVE, "gemini-2.5-flash", { keyLabel: "gemini#1", chainIndex: 0 });

    const texto = await p.generate({ messages: [{ role: "user", content: "oi" }], feature: "coach" });

    expect(texto).toBe("oi");
    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({
      provider: "gemini",
      model: "gemini-2.5-flash",
      keyLabel: "gemini#1",
      feature: "coach",
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
      ok: true,
    });
  });

  it("mede a latência real da chamada", async () => {
    vi.stubGlobal("fetch", respostaOk(25));
    const p = new GeminiProvider(CHAVE, "gemini-2.5-flash");

    await p.generate({ messages: [{ role: "user", content: "oi" }] });

    expect(registros[0].latencyMs).toBeGreaterThanOrEqual(20);
  });

  it("registra a falha de quota como 429 → quota", async () => {
    vi.stubGlobal("fetch", respostaErro(429));
    const p = new GeminiProvider(CHAVE, "gemini-2.5-flash");

    await expect(p.generate({ messages: [{ role: "user", content: "oi" }] })).rejects.toThrow();

    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({ ok: false, errorKind: "quota", totalTokens: 0 });
  });

  it("classifica 401 como auth e 500 como server", async () => {
    vi.stubGlobal("fetch", respostaErro(401));
    await expect(
      new GeminiProvider(CHAVE, "m").generate({ messages: [{ role: "user", content: "x" }] })
    ).rejects.toThrow();

    vi.stubGlobal("fetch", respostaErro(500));
    await expect(
      new GeminiProvider(CHAVE, "m").generate({ messages: [{ role: "user", content: "x" }] })
    ).rejects.toThrow();

    expect(registros.map((r) => r.errorKind)).toEqual(["auth", "server"]);
  });

  it("na cadeia de fallback, registra a chave que falhou E a que respondeu", async () => {
    const chamadas = [respostaErro(429), respostaOk()];
    let i = 0;
    vi.stubGlobal("fetch", vi.fn((...args: unknown[]) => chamadas[i++](...(args as []))));

    const chain = new FallbackProvider([
      new GeminiProvider(CHAVE, "m", { keyLabel: "gemini#1", chainIndex: 0 }),
      new GeminiProvider("outra", "m", { keyLabel: "gemini#2", chainIndex: 1 }),
    ]);

    await chain.generate({ messages: [{ role: "user", content: "oi" }] });

    expect(registros).toHaveLength(2);
    expect(registros[0]).toMatchObject({ keyLabel: "gemini#1", chainIndex: 0, ok: false, errorKind: "quota" });
    expect(registros[1]).toMatchObject({ keyLabel: "gemini#2", chainIndex: 1, ok: true, totalTokens: 150 });
  });

  it("captura o usage do formato OpenAI (Groq/OpenRouter)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      }) as unknown as Response)
    );
    const p = new OpenAICompatibleProvider("groq", "https://x", CHAVE, "llama", {}, {
      keyLabel: "groq#1",
      chainIndex: 3,
    });

    await p.generate({ messages: [{ role: "user", content: "oi" }], feature: "plan_generate" });

    expect(registros[0]).toMatchObject({
      provider: "groq",
      keyLabel: "groq#1",
      chainIndex: 3,
      feature: "plan_generate",
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      ok: true,
    });
  });

  it("um sink que explode não derruba a resposta ao usuário", async () => {
    setAiTelemetrySink(() => {
      throw new Error("banco caiu");
    });
    vi.stubGlobal("fetch", respostaOk());

    const texto = await new GeminiProvider(CHAVE, "m").generate({
      messages: [{ role: "user", content: "oi" }],
    });

    expect(texto).toBe("oi");
  });

  it("nunca coloca a chave de API no registro", async () => {
    vi.stubGlobal("fetch", respostaOk());
    await new GeminiProvider(CHAVE, "m", { keyLabel: "gemini#1", chainIndex: 0 }).generate({
      messages: [{ role: "user", content: "oi" }],
    });

    expect(JSON.stringify(registros)).not.toContain(CHAVE);
  });
});
