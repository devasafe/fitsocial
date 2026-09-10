// Chamada REAL ao modelo com uma foto, para provar que o contrato JSON se
// sustenta fora do mock — o mock prova o encanamento, não o prompt.
//
// Uso:
//   npx tsx src/scripts/tryRefeicao.ts                  (imagem sem comida)
//   npx tsx src/scripts/tryRefeicao.ts caminho/foto.jpg (prato de verdade)
//
// Sem argumento, manda uma imagem que NÃO tem comida: a resposta certa é uma
// lista vazia com explicação, e não um prato inventado. É o teste mais barato
// de "o modelo respeita as regras ou alucina".
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { analisarRefeicao } from "../services/ai/refeicaoPorFoto.js";
import { getAIProvider } from "../services/ai/index.js";

async function main() {
  const caminho = process.argv[2];

  const buffer = caminho
    ? readFileSync(caminho)
    : await sharp({
        create: { width: 600, height: 400, channels: 3, background: { r: 30, g: 60, b: 120 } },
      })
        .jpeg()
        .toBuffer();

  const provider = getAIProvider();
  console.log("provider:", provider.name, "| enxerga:", provider.aceitaImagem);
  console.log("foto:", caminho ?? "(retângulo azul, sem comida)");

  const inicio = Date.now();
  const analise = await analisarRefeicao({
    base64: buffer.toString("base64"),
    mimeType: "image/jpeg",
  });

  console.log(`\nresposta em ${Date.now() - inicio}ms:`);
  console.log(JSON.stringify(analise, null, 2));

  // Coerência dos macros: é o que o serviço reconcilia, e vale conferir se o
  // modelo já entrega certo ou se está sempre precisando de conserto.
  for (const i of analise.itens) {
    const dosMacros = Math.round(i.proteinaG * 4 + i.carboG * 4 + i.gorduraG * 9);
    console.log(
      `  ${i.nome}: ${i.kcal} kcal declarado, ${dosMacros} kcal pelos macros ` +
        `(${i.confianca})`
    );
  }
}

main().catch((err) => {
  console.error("Falhou:", err.message ?? err);
  process.exit(1);
});
