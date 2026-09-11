// As regras da paleta, verificadas por número.
//
//   npm run checar-cores
//
// Sem runner de teste: este projeto não tem nenhum, e trazer um por causa de
// oito asserções seria uma decisão de infra maior que o problema. Roda com o
// Node puro (`--experimental-strip-types`), que lê TypeScript direto.
//
// As regras existem porque já foram quebradas, todas em produção:
//
//   - `limeDim` ficou MAIS CLARO que a própria marca. O estado "apagado"
//     brilhava mais que o normal, e ninguém percebeu porque ninguém compara
//     dois hexadecimais no olho.
//   - `rgba(200,250,75,…)` estava cravado em sete arquivos e nenhum acompanhou
//     a troca de cor: o app ficou com a marca verde e os realces em lima.
//   - A rampa térmica terminava no lima, que ERA a marca, e ficou órfã quando a
//     marca mudou.
//
// Cor é a única parte do design system que dá para verificar por número. Onde
// dá, não vale conferir no olho.

import { colors, thermal } from "./theme.ts";

/** Luminância relativa (WCAG 2.1). */
function luminancia(hex: string): number {
  const canais = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = canais.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Matiz em graus. */
function matiz(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

let falhas = 0;
function exigir(condicao: boolean, regra: string, detalhe = ""): void {
  console.log(`${condicao ? "ok   " : "FALHA"}  ${regra}${detalhe ? `  — ${detalhe}` : ""}`);
  if (!condicao) falhas++;
}

const n = (v: number) => v.toFixed(2);

// ---- Contraste -------------------------------------------------------------

// 4,5:1 é o mínimo confortável para texto; 7:1 é o nível mais alto da norma.
exigir(
  contraste(colors.lime, colors.bg) > 7,
  "a marca é legível sobre o fundo",
  `${n(contraste(colors.lime, colors.bg))}:1`
);
exigir(
  contraste(colors.onLime, colors.lime) > 7,
  "o texto do botão primário é legível sobre a marca",
  `${n(contraste(colors.onLime, colors.lime))}:1`
);
exigir(
  luminancia(colors.limeDim) < luminancia(colors.lime),
  "o estado apagado é mais escuro que a marca",
  `${n(contraste(colors.limeDim, colors.bg))}:1 contra ${n(contraste(colors.lime, colors.bg))}:1`
);
exigir(contraste(colors.text, colors.bg) > 7, "o texto principal se separa do fundo");
exigir(contraste(colors.text2, colors.bg) > 4.5, "o texto secundário se separa do fundo");
// O terciário é placeholder e timestamp: 3:1 basta.
exigir(contraste(colors.text3, colors.bg) > 3, "o texto terciário se separa do fundo");

// A distinção existe porque é fácil errar: `limeBright` parece "o verde de
// texto", e sobre a marca ele some.
exigir(
  contraste(colors.limeBright, colors.bg) > 7 && contraste(colors.limeBright, colors.lime) < 3,
  "o verde claro serve sobre o FUNDO, e não sobre a marca",
  `${n(contraste(colors.limeBright, colors.bg))}:1 no fundo, ${n(contraste(colors.limeBright, colors.lime))}:1 na marca`
);

// ---- As transparências saem do hex, e não da mão ---------------------------

const rgb = [1, 3, 5].map((i) => parseInt(colors.lime.slice(i, i + 2), 16)).join(", ");
exigir(
  colors.limeSoft === `rgba(${rgb}, 0.12)` && colors.limeFaint === `rgba(${rgb}, 0.06)`,
  "as transparências são derivadas do hex da marca",
  colors.limeSoft
);

// ---- Rampa térmica ---------------------------------------------------------

const quantidade = thermal.slice(0, -1);
const excesso = thermal[thermal.length - 1];

// LUMINÂNCIA, não a luminosidade do HSL: pelo HSL um `#A8E01E` parecia caber no
// "forte" e era o passo mais claro da rampa inteira.
const luzes = quantidade.map(luminancia);
const sobe = luzes.every((l, i) => i === 0 || l > luzes[i - 1]);
exigir(sobe, "a luminância sobe a cada passo de quantidade", luzes.map((l) => l.toFixed(2)).join(" → "));

// "Excesso" não é mais quantidade: é alerta, e fala por matiz. Um vermelho mais
// claro que o "máximo" leria como "mais ainda", não como "passou do ponto".
exigir(
  luminancia(excesso) < luzes[luzes.length - 1] && matiz(excesso) < 30,
  "o último passo quebra a subida de propósito, e é quente",
  `${luminancia(excesso).toFixed(2)} de luminância, matiz ${matiz(excesso).toFixed(0)}°`
);

exigir(thermal.includes(colors.lime), "a rampa passa pela marca");
exigir(thermal[0] === colors.line, "a rampa começa no neutro");

// 104 → 79 → 45 → 14: nenhum salto é o dobro do outro.
const matizes = thermal.slice(2).map(matiz);
const passos = matizes.slice(1).map((h, i) => matizes[i] - h);
exigir(
  Math.max(...passos) < Math.min(...passos) * 2,
  "o passo de matiz é parelho ao esquentar",
  passos.map((p) => `${p.toFixed(0)}°`).join(" · ")
);

console.log(falhas === 0 ? "\nPALETA OK" : `\n${falhas} regra(s) quebrada(s)`);
process.exit(falhas === 0 ? 0 : 1);
