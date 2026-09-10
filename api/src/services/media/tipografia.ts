import { readFileSync } from "node:fs";
import { join } from "node:path";
import opentype from "opentype.js";

/* Texto virando vetor.
 *
 * O sharp desenha SVG com librsvg, que busca fonte pelo fontconfig do sistema.
 * Isso significa que o cartão sairia com Sora aqui e com uma fonte qualquer no
 * contêiner — sem erro nenhum, só diferente. É a pior categoria de bug: parece
 * certo para quem escreveu e sai errado para quem usa.
 *
 * Convertendo cada letra num `<path>`, o desenho não depende de fonte instalada
 * em lugar nenhum. O arquivo .ttf viaja com o código.
 *
 * A montagem é glifo a glifo, e não pelo `getPath` da biblioteca, porque aquele
 * caminho aplica recursos de OpenType (ccmp) que a biblioteca não implementa
 * para estas fontes e estoura. Aqui só se precisa de latim com kerning, que é o
 * pedaço simples do problema.
 */

const PASTA = join(process.cwd(), "assets", "fontes");

export type Fonte = "display" | "displayForte" | "corpo" | "corpoForte";

const ARQUIVOS: Record<Fonte, string> = {
  display: "Sora_700Bold.ttf",
  displayForte: "Sora_800ExtraBold.ttf",
  corpo: "Archivo_500Medium.ttf",
  corpoForte: "Archivo_600SemiBold.ttf",
};

// Parsear um .ttf custa alguns milissegundos, e um cartão desenha várias linhas.
const cache = new Map<Fonte, opentype.Font>();

function carregar(fonte: Fonte): opentype.Font {
  const existente = cache.get(fonte);
  if (existente) return existente;

  const buffer = readFileSync(join(PASTA, ARQUIVOS[fonte]));
  const parsed = opentype.parse(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  );
  cache.set(fonte, parsed);
  return parsed;
}

/** Os glifos do texto, na ordem, já com o kerning entre pares. */
function glifos(texto: string, font: opentype.Font) {
  return Array.from(texto).map((c) => font.charToGlyph(c));
}

/** Largura do texto naquele tamanho — para centralizar e para saber se cabe. */
export function larguraDoTexto(texto: string, fonte: Fonte, tamanho: number): number {
  const font = carregar(fonte);
  const escala = tamanho / font.unitsPerEm;
  const lista = glifos(texto, font);

  let largura = 0;
  for (let i = 0; i < lista.length; i++) {
    largura += lista[i].advanceWidth ?? 0;
    const proximo = lista[i + 1];
    if (proximo) largura += font.getKerningValue(lista[i], proximo);
  }
  return largura * escala;
}

/**
 * O texto como um `<path>` de SVG, já posicionado.
 *
 * `y` é a linha de base, como no SVG.
 */
export function textoEmVetor(
  texto: string,
  opcoes: {
    x: number;
    y: number;
    fonte: Fonte;
    tamanho: number;
    cor: string;
    ancora?: "esquerda" | "centro" | "direita";
    opacidade?: number;
  }
): string {
  const { x, y, fonte, tamanho, cor, ancora = "esquerda", opacidade } = opcoes;
  if (!texto) return "";

  const font = carregar(fonte);
  const escala = tamanho / font.unitsPerEm;
  const lista = glifos(texto, font);

  const largura = larguraDoTexto(texto, fonte, tamanho);
  const inicio = ancora === "centro" ? x - largura / 2 : ancora === "direita" ? x - largura : x;

  const caminho = new opentype.Path();
  let caneta = inicio;
  for (let i = 0; i < lista.length; i++) {
    const g = lista[i];
    // Arredondar a caneta a cada letra não é capricho: somar larguras deixa
    // resíduo de ponto flutuante (332.1000000000001 em vez de 332.1), e nessas
    // posições a biblioteca gera coordenadas NaN no caminho. O renderizador
    // não reclama — ele para de desenhar no primeiro NaN, e a frase aparece
    // cortada no meio. Foi assim que o título do treino sumiu pela metade.
    caneta = Math.round(caneta * 100) / 100;
    caminho.extend(g.getPath(caneta, y, tamanho));
    caneta += (g.advanceWidth ?? 0) * escala;
    const proximo = lista[i + 1];
    if (proximo) caneta += font.getKerningValue(g, proximo) * escala;
  }

  const d = caminho.toPathData(2);
  if (!d || d === "") return "";

  // Rede de segurança: se um NaN escapar, é melhor não desenhar nada do que
  // desenhar meia frase sem ninguém perceber.
  if (d.includes("NaN")) {
    console.error("[cartao] caminho com NaN, texto omitido:", texto);
    return "";
  }

  const alfa = opacidade != null ? ` fill-opacity="${opacidade}"` : "";
  return `<path d="${d}" fill="${cor}"${alfa}/>`;
}

/** Corta o texto com reticências quando não cabe na largura disponível. */
export function encurtar(texto: string, fonte: Fonte, tamanho: number, limite: number): string {
  if (larguraDoTexto(texto, fonte, tamanho) <= limite) return texto;

  let corte = texto;
  while (corte.length > 1 && larguraDoTexto(corte + "…", fonte, tamanho) > limite) {
    corte = corte.slice(0, -1);
  }
  return corte.trimEnd() + "…";
}
