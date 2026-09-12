import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Activity, type StrengthPayload } from "../models/Activity.js";
import { computeStrengthMetrics } from "../services/activityMetrics.js";

// Preenche `metrics.musculos` e `metrics.seriesPorGrupo` nos treinos de força
// gravados antes de esses campos existirem.
//
// NÃO é pré-requisito de nada: o feed e o perfil resolvem os músculos na
// leitura quando eles faltam (`musculosDoTreinoSalvo`). Isto existe para quem
// vai CONSULTAR o campo — o alerta de desequilíbrio do coach não pode varrer o
// payload de todo mundo a cada pergunta (docs/ESPORTES.md §4.3).
//
// Idempotente: recalcular dá o mesmo resultado. Reversível: o rollback tira só
// as duas chaves novas e não encosta em volumeTotalKg nem em seriesValidas.

export async function backfillForward(): Promise<{
  total: number;
  atualizadas: number;
  semMusculo: number;
  falharam: number;
}> {
  // `.cursor()` e não `.find()`: são todos os treinos de força de todo mundo, e
  // materializar os payloads de uma vez é o que mata o processo no container.
  const cursor = Activity.find({ kind: "strength" }).select("payload metrics").lean().cursor();

  let total = 0;
  let atualizadas = 0;
  let semMusculo = 0;
  let falharam = 0;

  for await (const treino of cursor) {
    total++;
    try {
      const payload = treino.payload as StrengthPayload | undefined;
      if (!payload || !Array.isArray(payload.exercises)) continue;

      const m = computeStrengthMetrics(payload);
      if (!m.musculos.length) {
        // Nenhum exercício resolveu. Não grava lista vazia: o campo ausente diz
        // "não sei", e a lista vazia diria "sei que não é nada" — e aí a leitura
        // pararia de tentar resolver pelo nome, que é justamente o que salva
        // esses treinos quando o catálogo crescer.
        semMusculo++;
        continue;
      }

      const r = await Activity.updateOne(
        { _id: treino._id },
        { $set: { "metrics.musculos": m.musculos, "metrics.seriesPorGrupo": m.seriesPorGrupo } }
      );
      // Conta o que GRAVOU, não o que tentou.
      atualizadas += r.modifiedCount ?? 0;
    } catch (err) {
      // Um treino torto não pode custar a migração dos outros: o payload é
      // `Mixed` e o que está gravado nunca passou pelo zod de hoje.
      falharam++;
      console.error(`[musculos] treino ${String(treino._id)} falhou:`, (err as Error).message);
    }
  }

  return { total, atualizadas, semMusculo, falharam };
}

/**
 * Tira os dois campos de TODO treino de força — inclusive dos que o código novo
 * gravou no create, não só dos que o backfill preencheu. É de propósito: é o
 * botão de "zerar o campo", e o feed e o perfil seguem certos porque resolvem
 * na leitura. Quem consulta `seriesPorGrupo` fica sem dado até rodar o forward.
 */
export async function backfillRollback(): Promise<{ limpas: number }> {
  const r = await Activity.updateMany(
    { kind: "strength" },
    { $unset: { "metrics.musculos": "", "metrics.seriesPorGrupo": "" } }
  );
  return { limpas: r.modifiedCount ?? 0 };
}

// CLI: `tsx src/scripts/backfillMuscleMetrics.ts [--rollback]`
if (process.argv[1]?.includes("backfillMuscleMetrics")) {
  const rollback = process.argv.includes("--rollback");
  connectDB()
    .then(async () => {
      if (rollback) {
        const r = await backfillRollback();
        console.log(`[musculos] rollback: ${r.limpas} treinos sem os campos novos`);
      } else {
        const r = await backfillForward();
        console.log(
          `[musculos] ${r.atualizadas} atualizados, ${r.semMusculo} sem músculo reconhecido, ${r.falharam} com payload torto (de ${r.total} treinos de força)`
        );
      }
      await mongoose.disconnect();
    })
    .catch((err) => {
      console.error("[musculos] falhou:", err);
      process.exit(1);
    });
}
