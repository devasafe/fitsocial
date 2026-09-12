import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Activity } from "../models/Activity.js";
import { PersonalRecord } from "../models/PersonalRecord.js";
import { slugDoExercicio } from "../services/slug.js";

// O que o backfill FARIA, sem fazer nada.
//
// Existe porque o backfill mexe em recorde de gente que já usa o app, e
// "confia, é idempotente" não é resposta suficiente antes de rodar em
// produção. Este script só lê: dá para rodar no banco de produção, a qualquer
// hora, sem ensaiar em cópia nenhuma.
//
// O que ele responde:
//   - quantos treinos de força ganham slug;
//   - quantos exercícios o catálogo não reconhece (ficam sem slug);
//   - QUAIS recordes se fundem, um a um, com o valor que vai sobrar.
//
// A fusão é a parte que assusta e é a parte que importa: dois recordes do
// mesmo exercício escritos de jeitos diferentes viram um só, e o que fica é o
// melhor dos dois.

interface ExercicioGravado {
  name?: unknown;
  exerciseId?: unknown;
  slug?: unknown;
}

/** Menor é melhor nestes tipos — tempo. Vem do prEngine (MIN_TYPES). */
const MENOR_MELHOR = new Set(["best_time", "wod_time"]);

async function diagnosticar(): Promise<void> {
  // ---- Metade 1: os treinos ----
  const cursor = Activity.find({ kind: "strength" }).select("payload").lean().cursor();

  let treinos = 0;
  let ganhamSlug = 0;
  let jaTem = 0;
  const naoReconhecidos = new Map<string, number>();

  for await (const t of cursor) {
    treinos++;
    const exercicios = (t.payload as { exercises?: ExercicioGravado[] } | undefined)?.exercises;
    if (!Array.isArray(exercicios)) continue;

    let mudaAlgo = false;
    let tinhaTudo = exercicios.length > 0;

    for (const ex of exercicios) {
      const nome = typeof ex?.name === "string" ? ex.name : "";
      const slug = slugDoExercicio(nome, typeof ex?.exerciseId === "string" ? ex.exerciseId : null);
      if (!slug) {
        naoReconhecidos.set(nome, (naoReconhecidos.get(nome) ?? 0) + 1);
        continue;
      }
      if (ex?.slug !== slug) mudaAlgo = true;
      if (ex?.slug !== slug) tinhaTudo = false;
    }

    if (mudaAlgo) ganhamSlug++;
    else if (tinhaTudo) jaTem++;
  }

  console.log("");
  console.log("TREINOS DE FORÇA");
  console.log(`  total ............... ${treinos}`);
  console.log(`  ganham slug ......... ${ganhamSlug}`);
  console.log(`  já estão em dia ..... ${jaTem}`);

  if (naoReconhecidos.size > 0) {
    console.log("");
    console.log("  Exercícios sem nome utilizável (ficam sem slug, e fora do gráfico):");
    for (const [nome, vezes] of [...naoReconhecidos].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      console.log(`    ${vezes}x  ${JSON.stringify(nome)}`);
    }
  }

  // ---- Metade 2: os recordes que se fundem ----
  const prs = await PersonalRecord.find({}).select(
    "user exerciseName exerciseSlug type repRange value unit achievedAt"
  );

  // Agrupa pela chave NOVA. Onde dois documentos caírem no mesmo balde, há
  // fusão — e é exatamente isso que o índice único novo vai passar a exigir.
  const baldes = new Map<string, typeof prs>();
  for (const pr of prs) {
    // Quem já migrou tem a identidade gravada; quem não, deriva do nome —
    // que é o que o backfill vai fazer quando reconstruir do histórico.
    const slug = pr.exerciseSlug || slugDoExercicio(pr.exerciseName, null);
    const chave = `${pr.user}|${slug}|${pr.type}|${pr.repRange ?? ""}`;
    const lista = baldes.get(chave) ?? [];
    lista.push(pr);
    baldes.set(chave, lista);
  }

  const fusoes = [...baldes.entries()].filter(([, lista]) => lista.length > 1);

  console.log("");
  console.log("RECORDES");
  console.log(`  hoje ................ ${prs.length}`);
  console.log(`  depois do backfill .. ${baldes.size}`);
  console.log(`  fusões .............. ${fusoes.length}`);

  if (fusoes.length > 0) {
    console.log("");
    console.log("  O que vai se juntar:");
    for (const [chave, lista] of fusoes) {
      const [, slug, tipo] = chave.split("|");
      const menorMelhor = MENOR_MELHOR.has(tipo);
      const fica = lista.reduce((a, b) => (menorMelhor ? (a.value <= b.value ? a : b) : a.value >= b.value ? a : b));
      const nomes = lista.map((p) => `${JSON.stringify(p.exerciseName)} = ${p.value}${p.unit}`).join("  +  ");
      console.log(`    [${slug} · ${tipo}]`);
      console.log(`       ${nomes}`);
      console.log(`       fica: ${fica.value}${fica.unit}`);
    }
  }

  console.log("");
  console.log("Nada foi alterado. Para aplicar: npm run exercicios:backfill");
  console.log("");
}

if (process.argv[1]?.includes("diagnosticarSlugs")) {
  connectDB()
    .then(async () => {
      await diagnosticar();
      await mongoose.disconnect();
    })
    .catch((err) => {
      console.error("[slugs] diagnóstico falhou:", err);
      process.exit(1);
    });
}

export { diagnosticar };
