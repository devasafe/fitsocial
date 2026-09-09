import { describe, it, expect } from "vitest";
import { FallbackProvider } from "./fallback.js";
import { AIError, type AIProvider, type GenerateOptions } from "./provider.js";

function stub(name: string, gen: () => Promise<string>): AIProvider {
  return { name, generate: gen };
}
const opts: GenerateOptions = { messages: [{ role: "user", content: "oi" }] };

describe("FallbackProvider", () => {
  it("retorna a primeira resposta bem-sucedida", async () => {
    const p = new FallbackProvider([stub("a", async () => "A"), stub("b", async () => "B")]);
    expect(await p.generate(opts)).toBe("A");
  });

  it("cai pra próxima chave quando a atual estoura a quota (erro retornável)", async () => {
    const p = new FallbackProvider([
      stub("a", async () => {
        throw new AIError("quota estourada", true);
      }),
      stub("b", async () => "B"),
    ]);
    expect(await p.generate(opts)).toBe("B");
  });

  it("para na hora em erro não-retornável (não desperdiça as outras chaves)", async () => {
    let bCalled = false;
    const p = new FallbackProvider([
      stub("a", async () => {
        throw new AIError("conteúdo bloqueado", false);
      }),
      stub("b", async () => {
        bCalled = true;
        return "B";
      }),
    ]);
    await expect(p.generate(opts)).rejects.toThrow("conteúdo bloqueado");
    expect(bCalled).toBe(false);
  });

  it("propaga o último erro quando todas as chaves falham", async () => {
    const p = new FallbackProvider([
      stub("a", async () => {
        throw new AIError("q1", true);
      }),
      stub("b", async () => {
        throw new AIError("q2", true);
      }),
    ]);
    await expect(p.generate(opts)).rejects.toThrow("q2");
  });
});
