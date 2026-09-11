import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { textoEmVetor, larguraDoTexto, encurtar } from "./tipografia.js";

/* O texto do cartão vira vetor, e vetor não avisa quando sai errado.
 *
 * Estes testes existem por causa de um bug real: somar larguras de letra deixa
 * resíduo de ponto flutuante, e em certas posições a biblioteca gerava uma
 * coordenada NaN. O renderizador não reclamava — parava de desenhar ali. O
 * título do treino aparecia cortado no meio da palavra, e nada no código
 * indicava por quê.
 *
 * Por isso a verificação mede a TINTA no PNG, e não o que a função diz. */

/** Até onde o desenho realmente chega, em pixels. */
async function tintaAte(svgInterno: string, largura = 2400): Promise<number> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="160"><rect width="${largura}" height="160" fill="#000"/>${svgInterno}</svg>`;
  const { data, info } = await sharp(Buffer.from(svg)).raw().toBuffer({ resolveWithObject: true });

  let maior = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels] > 120 && x > maior) maior = x;
    }
  }
  return maior;
}

const FRASES = [
  ["Alguem com um nome bem comprido de verdade", "corpo", 30],
  ["Fran — 21-15-9 thruster e pull-up", "display", 56],
  ["Reticências, acentuação e ação", "corpo", 34],
  ["5:18 /km", "displayForte", 76],
] as const;

describe("texto do cartão vira vetor sem perder pedaço", () => {
  for (const [texto, fonte, tamanho] of FRASES) {
    it(`desenha a frase inteira: ${texto.slice(0, 28)}`, async () => {
      const esperado = larguraDoTexto(texto, fonte, tamanho);
      const fim = await tintaAte(
        textoEmVetor(texto, { x: 20, y: 120, fonte, tamanho, cor: "#ffffff" })
      );

      // A tinta para um pouco antes do avanço da última letra (o espaço lateral
      // do glifo), por isso a folga — mas nunca metade da frase.
      expect(fim - 20).toBeGreaterThan(esperado * 0.9);
      expect(fim - 20).toBeLessThanOrEqual(esperado + 4);
    });
  }

  it("nenhuma posição de caneta gera coordenada inválida", () => {
    // Cada início desloca a caneta de um jeito diferente e vai acumulando
    // resíduo diferente — é assim que o bug original aparecia só às vezes.
    for (let x = 0; x < 200; x += 7) {
      const svg = textoEmVetor("Corrida de rua com o Asafe e mais gente", {
        x,
        y: 100,
        fonte: "display",
        tamanho: 47,
        cor: "#fff",
      });
      expect(svg, `caneta em x=${x}`).not.toContain("NaN");
      expect(svg.length, `caneta em x=${x}`).toBeGreaterThan(500);
    }
  });

  it("a linha de base com resíduo de float também desenha", () => {
    // 132 * 1.02 = 134.64000000000001, e essa e a conta da altura do resultado
    // no cartao. Com o x impecavel e o y assim, a frase INTEIRA virava NaN e o
    // cartao saia sem o resultado — sem erro visivel para ninguem.
    const suspeitos = [132 * 1.02, 300.1 + 0.2, 102.96000000000001, 47 * 0.78 + 220.3];

    for (const y of suspeitos) {
      const svg = textoEmVetor("5:32 RX 90 reps", {
        x: 72,
        y,
        fonte: "displayForte",
        tamanho: 132,
        cor: "#fff",
      });
      expect(svg, `linha de base em y=${y}`).not.toContain("NaN");
      expect(svg.length, `linha de base em y=${y}`).toBeGreaterThan(500);
    }
  });
});

describe("encurtar", () => {
  it("devolve o texto inteiro quando cabe", () => {
    expect(encurtar("Fran", "display", 56, 1000)).toBe("Fran");
  });

  it("corta e marca com reticências quando não cabe", () => {
    const curto = encurtar("Fran com um nome absurdamente longo", "display", 56, 300);
    expect(curto.endsWith("…")).toBe(true);
    expect(larguraDoTexto(curto, "display", 56)).toBeLessThanOrEqual(300);
  });

  it("a reticência é desenhada, não só contada", async () => {
    // Ela entra na conta da largura; se o glifo não existisse na fonte, o
    // texto sairia cortado sem nenhuma marca de que faltou coisa.
    const so = await tintaAte(
      textoEmVetor("…", { x: 20, y: 120, fonte: "display", tamanho: 56, cor: "#fff" }),
      200
    );
    expect(so).toBeGreaterThan(20);
  });
});
