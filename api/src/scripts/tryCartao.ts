// Gera os layouts do cartão para olhar. Sem servidor, sem banco.
//
// Desenho é para ser visto, não descrito: este script existe para escolher
// layout olhando, e não lendo código.
import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { montarCartao, LAYOUTS, type DadosDoCartao } from "../services/media/cartaoDeCompartilhar.js";

const SAIDA = "C:/Users/00asa/.claude/jobs/4af5bd50/tmp";

/** Uma "foto" com claro e escuro, para ver se o texto sobrevive aos dois. */
async function fotoFalsa(): Promise<Buffer> {
  return sharp({
    create: { width: 1400, height: 1800, channels: 3, background: { r: 236, g: 226, b: 208 } },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1800">
             <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
               <stop offset="0%" stop-color="#8fb0d6"/><stop offset="100%" stop-color="#f0c89a"/>
             </linearGradient></defs>
             <rect width="1400" height="1800" fill="url(#g)"/>
             <circle cx="700" cy="620" r="430" fill="#e8873f" opacity="0.92"/>
             <rect x="0" y="1180" width="1400" height="620" fill="#4a5b47"/>
             <rect x="120" y="1290" width="1160" height="70" rx="35" fill="#dfe6d8" opacity="0.8"/>
           </svg>`
        ),
        top: 0,
        left: 0,
      },
    ])
    .jpeg()
    .toBuffer();
}

const percurso = Array.from({ length: 420 }, (_, i) => {
  const t = (i / 420) * Math.PI * 2;
  return {
    lat: -23.56 + Math.sin(t) * 0.011 + Math.sin(t * 3) * 0.003,
    lng: -46.65 + Math.cos(t) * 0.016,
  };
});

async function main() {
  const foto = await fotoFalsa();

  const wod: DadosDoCartao = {
    foto,
    titulo: "Fran",
    stats: ["5:32", "RX", "90 reps"],
    movimentos: ["21-15-9  Thruster  43 kg", "21-15-9  Pull Up"],
    cor: "#F5C63C",
    percurso: null,
    autor: "Asafe Nascimento",
  };

  const corrida: DadosDoCartao = {
    foto,
    titulo: "Corrida de rua",
    stats: ["5,2 km", "27:30", "5:18 /km"],
    movimentos: [],
    cor: "#FF8A4C",
    percurso,
    autor: "Asafe Nascimento",
  };

  const wodLongo: DadosDoCartao = {
    foto,
    titulo: "Relay — Bloco A",
    stats: ["7 + 1", "AMRAP 6'", "em dupla"],
    movimentos: [
      "100 m  Run",
      "2  Rope Climb",
      "20  Burpee Box Jump Over",
      "10  Chest to Bar",
      "400 m  Run together",
    ],
    cor: "#F5C63C",
    percurso: null,
    autor: "Asafe Nascimento",
  };

  const casos: [string, DadosDoCartao][] = [
    ["wod", wod],
    ["corrida", corrida],
    ["longo", wodLongo],
  ];

  for (const layout of LAYOUTS) {
    for (const [nome, dados] of casos) {
      const png = await montarCartao(dados, "story", layout);
      const arquivo = `${SAIDA}/lay-${layout}-${nome}.png`;
      writeFileSync(arquivo, png);
    }
  }

  // Sem foto: prova que qualquer layout cai no tipográfico.
  writeFileSync(
    `${SAIDA}/lay-semfoto.png`,
    await montarCartao({ ...wod, foto: null }, "story", "foto")
  );

  console.log(`gerou ${LAYOUTS.length * casos.length + 1} imagens em ${SAIDA}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
