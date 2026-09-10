// Chamada REAL ao modelo com um quadro de aula, para ver se o contrato se
// sustenta fora do mock. Mock prova o encanamento, não o prompt.
//
//   npx tsx src/scripts/tryQuadro.ts             (o quadro de exemplo abaixo)
//   npx tsx src/scripts/tryQuadro.ts arquivo.txt (um quadro seu)
import { readFileSync } from "node:fs";
import { lerQuadro } from "../services/ai/lerQuadro.js";
import { getAIProvider } from "../services/ai/index.js";

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

async function main() {
  const caminho = process.argv[2];
  const texto = caminho ? readFileSync(caminho, "utf8") : EXEMPLO;

  console.log("provider:", getAIProvider().name);
  console.log("quadro:", caminho ?? "(exemplo)");

  const inicio = Date.now();
  const leitura = await lerQuadro(texto);
  console.log(`\nleu em ${Date.now() - inicio}ms — ${leitura.blocos.length} blocos\n`);

  for (const [i, b] of leitura.blocos.entries()) {
    const partes: string[] = [`${i + 1}. ${b.tipo}`];

    if (b.tipo === "metcon") {
      partes.push(b.formato);
      if (b.nome) partes.push(`"${b.nome}"`);
      if (b.grupo) partes.push(`grupo=${b.grupo}`);
      if (b.equipe) partes.push(`equipe=${b.equipe.tamanho} ${b.equipe.modo}`);
      const p = b.prescricao;
      if (p.duracaoSec) partes.push(`${p.duracaoSec}s`);
      if (p.timeCapSec) partes.push(`cap ${p.timeCapSec}s`);
      if (p.intervaloSec) partes.push(`a cada ${p.intervaloSec}s`);
      if (p.rounds) partes.push(`${p.rounds} rounds`);
      console.log(partes.join(" · "));
      for (const m of p.movimentos) {
        const q = [
          m.reps && `${m.reps} reps`,
          m.repScheme?.join("-"),
          m.distanciaM && `${m.distanciaM}m`,
          m.calorias && `${m.calorias} cal`,
          m.carga?.valor && `${m.carga.valor}${m.carga.unidade}`,
          m.porPessoa && "(cada)",
        ]
          .filter(Boolean)
          .join(" ");
        console.log(`      - ${m.nome}${q ? "  " + q : ""}`);
      }
      // A regra que faz isto ser seguro.
      if (b.resultado) console.log("      !! RESULTADO INVENTADO (deveria ter sido descartado)");
    } else if (b.tipo === "descanso") {
      console.log(`${partes.join(" · ")} · ${b.duracaoSec}s`);
    } else if (b.tipo === "skill") {
      console.log(`${partes.join(" · ")} · ${b.movimento}`);
    } else if (b.tipo === "forca") {
      console.log(`${partes.join(" · ")} · ${b.exercicios.map((e) => e.name).join(", ")}`);
    } else {
      if (b.formato) partes.push(b.formato);
      if (b.intervaloSec) partes.push(`a cada ${b.intervaloSec}s`);
      if (b.rounds) partes.push(`${b.rounds} rounds`);
      console.log(partes.join(" · "));
      for (const m of b.movimentos) console.log(`      - ${m.nome}  ${m.reps ?? ""}`);
    }
  }

  if (leitura.observacao) console.log("\nobservação:", leitura.observacao);
}

main().catch((err) => {
  console.error("Falhou:", err.message ?? err);
  process.exit(1);
});
