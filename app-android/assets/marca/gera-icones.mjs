// Gera tudo que a marca precisa a partir de UM arquivo: assets/marca/rumo-simbolo.svg.
//
// É o ponto do vetor: mudar a logo é mudar aquele arquivo e rodar isto de novo.
// Antes eram seis PNGs soltos que ninguém sabia de onde tinham vindo.
import sharp from "sharp";
import opentype from "opentype.js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const APP = "D:/PROJETOS/FitSocial/app-android";
const SVG = readFileSync(`${APP}/assets/marca/rumo-simbolo.svg`, "utf8");
const MOSTRUARIO = "C:/Users/00asa/Desktop/FitSocial-layouts";

const VERDE = "#3BCC06";
const FUNDO = "#0E1310";

const pintado = (cor) => Buffer.from(
  SVG.replace(/currentColor/g, cor).replace(/var\(--rumo-acento, #3BCC06\)/g, cor)
);
const simbolo = (px, cor = VERDE) => sharp(pintado(cor)).resize(px, px).png().toBuffer();

/** O símbolo centrado numa arte quadrada, ocupando `fracao` dela. */
async function quadrado(px, fracao, fundo, cor = VERDE) {
  const dentro = Math.round(px * fracao);
  const base = fundo
    ? sharp({ create: { width: px, height: px, channels: 4, background: fundo } })
    : sharp({ create: { width: px, height: px, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  return base
    .composite([{ input: await simbolo(dentro, cor), gravity: "center" }])
    .png()
    .toBuffer();
}

const preto = { r: 14, g: 19, b: 16, alpha: 1 };

// ---- Os arquivos que o app.config.js aponta -------------------------------

mkdirSync(`${APP}/assets`, { recursive: true });

// Ícone da loja e do app: fundo cheio, símbolo com folga.
writeFileSync(`${APP}/assets/icon.png`, await quadrado(1024, 0.62, preto));

// Adaptativo do Android: o primeiro plano precisa caber no círculo/squircle que
// o launcher recorta, então o símbolo ocupa MENOS do que no ícone comum.
writeFileSync(`${APP}/assets/android-icon-foreground.png`, await quadrado(1024, 0.46, null));
writeFileSync(
  `${APP}/assets/android-icon-background.png`,
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: preto } }).png().toBuffer()
);

// Monocromático: o launcher pinta por cima, então o arquivo é uma SILHUETA
// branca sobre transparente. Branco e nao o verde — a cor aqui e descartada.
writeFileSync(`${APP}/assets/android-icon-monochrome.png`, await quadrado(1024, 0.46, null, "#FFFFFF"));

writeFileSync(`${APP}/assets/favicon.png`, await quadrado(96, 0.78, preto));
writeFileSync(`${APP}/assets/splash-icon.png`, await quadrado(512, 0.7, null));

// ---- O mostruário, para olhar antes de confiar ---------------------------

const fontes = "D:/PROJETOS/FitSocial/api/assets/fontes";
const buf = readFileSync(`${fontes}/Sora_800ExtraBold.ttf`);
const sora = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

function textoEmVetor(str, { x, y, tamanho, cor, espacamento = 0 }) {
  const escala = tamanho / sora.unitsPerEm;
  let caneta = Math.round(x * 100) / 100;
  const base = Math.round(y * 100) / 100;
  const ds = [];
  for (const ch of str) {
    const g = sora.charToGlyph(ch);
    const d = g.getPath(caneta, base, tamanho).toPathData(2);
    if (d.includes("NaN")) throw new Error(`NaN em ${JSON.stringify(ch)}`);
    if (d) ds.push(d);
    caneta = Math.round((caneta + g.advanceWidth * escala + espacamento) * 100) / 100;
  }
  return { d: `<path d="${ds.join(" ")}" fill="${cor}"/>`, largura: caneta - x };
}

const CAIXA = 230;
const GAP = 26;
const casos = [
  ["512px", await quadrado(CAIXA, 0.8, preto)],
  ["48px — tela inicial", await sharp(await quadrado(48, 0.8, preto)).resize(CAIXA, CAIXA, { kernel: "nearest" }).png().toBuffer()],
  ["16px — favicon", await sharp(await quadrado(16, 0.8, preto)).resize(CAIXA, CAIXA, { kernel: "nearest" }).png().toBuffer()],
  ["monocromático", await quadrado(CAIXA, 0.8, { r: 40, g: 40, b: 40, alpha: 1 }, "#FFFFFF")],
  ["sobre fundo claro", await quadrado(CAIXA, 0.8, { r: 245, g: 245, b: 242, alpha: 1 }, "#2A3327")],
  ["sobre foto", null],
];

// "sobre foto": o teste que o JPEG não passava.
const foto = await sharp({ create: { width: CAIXA, height: CAIXA, channels: 3, background: { r: 150, g: 130, b: 105 } } })
  .composite([
    {
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${CAIXA}" height="${CAIXA}">
           <rect width="${CAIXA}" height="${CAIXA}" fill="#8fa8c4"/>
           <circle cx="70" cy="60" r="80" fill="#e8873f"/>
           <rect y="150" width="${CAIXA}" height="90" fill="#3f5340"/>
         </svg>`
      ),
      top: 0,
      left: 0,
    },
    { input: await simbolo(Math.round(CAIXA * 0.8), "#FFFFFF"), gravity: "center" },
  ])
  .png()
  .toBuffer();
casos[5][1] = foto;

const L = casos.length * CAIXA + (casos.length + 1) * GAP;
const H = CAIXA + 260;

const marca = textoEmVetor("RUMO", { x: GAP, y: H - 60, tamanho: 108, cor: "#EDEBE1", espacamento: 2 });
// A assinatura de verdade vive em rumo-assinatura.svg; esta aqui e so referencia.
const simboloDaAssinatura = await simbolo(104, VERDE);

const rotulos = casos
  .map(
    ([r], i) =>
      `<text x="${GAP + i * (CAIXA + GAP) + CAIXA / 2}" y="74" font-family="Arial" font-size="18"
             fill="#A8AC9E" text-anchor="middle">${r}</text>`
  )
  .join("");

const svgFolha = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${H}">
     <text x="${GAP}" y="38" font-family="Arial" font-size="23" font-weight="bold" fill="#EDEBE1">
       RUMO — o símbolo, em vetor, nos lugares em que ele vai viver
     </text>
     ${rotulos}
     ${marca.d}
   </svg>`
);

const folha = await sharp({ create: { width: L, height: H, channels: 3, background: { r: 14, g: 19, b: 16 } } })
  .composite([
    ...casos.map(([, img], i) => ({ input: img, left: GAP + i * (CAIXA + GAP), top: 92 })),
    { input: svgFolha, top: 0, left: 0 },
    // A assinatura: símbolo + palavra, que é como a marca aparece inteira.
    { input: simboloDaAssinatura, left: Math.round(GAP + marca.largura + 30), top: H - 148 },
  ])
  .png()
  .toBuffer();

writeFileSync(`${MOSTRUARIO}/RUMO-marca.png`, folha);
console.log("gerou o mostruário e os 6 assets do app");
