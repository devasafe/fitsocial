// Chamada REAL ao modelo com um quadro de aula, para ver se o contrato se
// sustenta fora do mock. Mock prova o encanamento, não o prompt.
//
//   npx tsx src/scripts/tryQuadro.ts             (o quadro de exemplo abaixo)
//   npx tsx src/scripts/tryQuadro.ts arquivo.txt (um quadro seu)
import { readFileSync } from "node:fs";
import { lerQuadro } from "../services/ai/lerQuadro.js";
import { getAIProvider } from "../services/ai/index.js";
import type { Movimento } from "../models/crossfit.js";

/** Um quadro real, com tudo que costuma quebrar leitura automática:
 *  EMOM com intervalo quebrado, alternativa com "OU", revezamento, descanso
 *  entre partes, "cada", e abreviações de box. */
const EXEMPLO = `WARM-UP
EMOM (1'15") X 4
-4 Beat Swing
-2 Pull Up
-20 Skipping
-4 Broad Jump

SKILL / STRENGTH
ROPE CLIMB

"OU"

*AMRAP 8'
-10 Bíceps Curl (Barbell)
-10 Jump Squat (Barbell Back Rack)
-10 Ktb Russian Swing
-100 Mts Farm Carry

WOD
AMRAP + FOR TIME

*BLOCO A) - AMRAP 6'
"Relay"
-100 Mts Run
-2 Rope Climb

*REST 1'

*BLOCO B) - AMRAP 6'
"Relay"
-20 BJO
-10 C2B

*REST 1'

*FOR TIME 7'
-400 Mts Run Together
-2 Rope Climb (cada)
-40 BJO
-20 C2B`;

/** "21-15-9  Thruster  43/30 kg  (cada)" */
function umaLinha(m: Movimento): string {
  const v = m.volume;
  const valor = v ? (Array.isArray(v.valor) ? v.valor.join("-") : String(v.valor)) : "";
  const unidade = v && v.unidade !== "reps" ? ` ${v.unidade}` : "";
  const carga = m.carga?.rx != null
    ? `  ${m.carga.rx}${m.carga.rxF != null ? "/" + m.carga.rxF : ""} ${m.carga.unidade}`
    : m.carga?.texto
      ? `  ${m.carga.texto}`
      : "";
  const escopo = m.escopo !== "individual" ? `  (${m.escopo})` : "";
  const series = m.series ? `${m.series}x` : "";

  return `${series}${valor}${unidade}  ${m.nome}${carga}${escopo}`.trim();
}

async function main() {
  const caminho = process.argv[2];
  const texto = caminho ? readFileSync(caminho, "utf8") : EXEMPLO;

  console.log("provider:", getAIProvider().name);
  console.log("quadro:", caminho ?? "(exemplo)");

  const inicio = Date.now();
  const leitura = await lerQuadro(texto);
  console.log(
    `\nleu em ${Date.now() - inicio}ms — ${leitura.blocos.length} blocos, time de ${leitura.tamanhoDoTime}\n`
  );

  for (const [i, b] of leitura.blocos.entries()) {
    const l = b.lido;
    const estrutura = [
      l?.familia,
      l?.duracaoSec && `${l.duracaoSec}s`,
      l?.timeCapSec && `cap ${l.timeCapSec}s`,
      l?.intervaloSec && `janela ${l.intervaloSec}s`,
      l?.rounds && `${l.rounds} rounds`,
      l?.scoreSugerido && `score=${l.scoreSugerido}`,
    ]
      .filter(Boolean)
      .join(" · ");

    console.log(`${i + 1}. "${b.modo}"${b.nome ? `  [${b.nome}]` : ""}`);
    console.log(`      → ${estrutura}`);
    for (const m of b.movimentos) console.log(`      - ${umaLinha(m)}`);

    // A regra que faz isto ser seguro.
    if (b.resultado) console.log("      !! RESULTADO INVENTADO (deveria ter sido descartado)");
  }

  if (leitura.observacao) console.log("\nobservação:", leitura.observacao);
}

main().catch((err) => {
  console.error("Falhou:", err.message ?? err);
  process.exit(1);
});
