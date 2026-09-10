// Gera os dois formatos do cartao para olhar. Sem servidor, sem banco.
import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { montarCartao } from "../services/media/cartaoDeCompartilhar.js";

// Uma "foto" com variacao, para ver se o texto sobrevive a fundo claro.
async function fotoFalsa(): Promise<Buffer> {
  return sharp({
    create: { width: 1200, height: 1600, channels: 3, background: { r: 232, g: 220, b: 200 } },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600">
             <circle cx="600" cy="520" r="380" fill="#f0a35e"/>
             <rect x="0" y="1100" width="1200" height="500" fill="#cfd8c5"/>
           </svg>`
        ),
        top: 0,
        left: 0,
      },
    ])
    .jpeg()
    .toBuffer();
}

// Um percurso em forma de laco, para o tracado ter o que mostrar.
const percurso = Array.from({ length: 400 }, (_, i) => {
  const t = (i / 400) * Math.PI * 2;
  return {
    lat: -23.56 + Math.sin(t) * 0.012 + Math.sin(t * 3) * 0.003,
    lng: -46.65 + Math.cos(t) * 0.018,
  };
});

async function main() {
  const foto = await fotoFalsa();

  const corrida = {
    foto,
    titulo: "Corrida de rua",
    stats: ["5,2 km", "27:30", "5:18 /km"],
    cor: "#FF8A4C",
    percurso,
    autor: "Asafe Nascimento",
  };

  writeFileSync("C:/Users/00asa/.claude/jobs/4af5bd50/tmp/cartao-story.png", await montarCartao(corrida, "story"));
  writeFileSync("C:/Users/00asa/.claude/jobs/4af5bd50/tmp/cartao-feed.png", await montarCartao(corrida, "feed"));

  // Sem foto e com titulo longo: os dois casos que mais quebram layout.
  writeFileSync(
    "C:/Users/00asa/.claude/jobs/4af5bd50/tmp/cartao-sem-foto.png",
    await montarCartao(
      {
        foto: null,
        titulo: "Fran — 21-15-9 thruster e pull-up, e o nome segue enorme",
        stats: ["RX", "5:32"],
        cor: "#F5C63C",
        percurso: null,
        autor: "Alguem com um nome bem comprido de verdade",
      },
      "story"
    )
  );
  console.log("gerou cartao-story.png, cartao-feed.png e cartao-sem-foto.png");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
