import { describe, it, expect } from "vitest";
import { FallbackProvider } from "./fallback.js";
import { AIError, type AIProvider, type GenerateOptions } from "./provider.js";

function stub(name: string, gen: () => Promise<string>, aceitaImagem = false): AIProvider {
  return { name, aceitaImagem, generate: gen };
}
const opts: GenerateOptions = { messages: [{ role: "user", content: "oi" }] };

const comFoto: GenerateOptions = {
  messages: [{ role: "user", content: "o que tem no prato?" }],
  imagem: { base64: "abc", mimeType: "image/jpeg" },
};

describe("FallbackProvider", () => {
  it("com imagem, pula quem nao enxerga em vez de mandar assim mesmo", async () => {
    const visitados: string[] = [];
    const p = new FallbackProvider([
      stub("so-texto", async () => {
        visitados.push("so-texto");
        return "chutei";
      }),
      stub(
        "com-visao",
        async () => {
          visitados.push("com-visao");
          return "arroz e frango";
        },
        true
      ),
    ]);

    // Modelo de texto nao recusa uma foto: ele responde com confianca sobre um
    // prato que nunca viu, e a pessoa registra macros inventados no diario.
    expect(await p.generate(comFoto)).toBe("arroz e frango");
    expect(visitados).toEqual(["com-visao"]);
  });

  it("sem imagem, todos continuam elegiveis", async () => {
    const p = new FallbackProvider([stub("so-texto", async () => "A")]);
    expect(await p.generate(opts)).toBe("A");
  });

  it("erro claro quando nenhum modelo configurado enxerga", async () => {
    const p = new FallbackProvider([stub("so-texto", async () => "A")]);
    await expect(p.generate(comFoto)).rejects.toThrow(/analisa imagem/);
  });

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
