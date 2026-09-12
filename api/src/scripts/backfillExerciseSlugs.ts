import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Activity } from "../models/Activity.js";
import { PersonalRecord } from "../models/PersonalRecord.js";
import { slugDoExercicio } from "../services/slug.js";
import { recomputeUserPRs } from "../services/prEngine.js";

// Dá identidade aos exercícios já gravados, para o histórico de cada um ser UM.
//
// Antes deste campo, a chave do progresso e do recorde era o nome cru digitado:
// "Supino reto", "supino reto" e "Supino  Reto " eram três exercícios distintos.
// O forward tem duas metades, nesta ordem, e a ordem importa:
//
//   1. preenche `payload.exercises[].slug` nos treinos de força;
//   2. refaz os recordes a partir desses treinos, o que FUNDE os que estavam
//      separados por grafia — `recomputeUserPRs` já apaga e reconstrói do
//      histórico ordenado, então a fusão sai de graça e com o valor certo.
//
// Só depois disso `syncIndexes()` consegue trocar o índice único de nome para
// slug: enquanto houver recorde antigo sem slug, vários documentos colidiriam
// em (user, "", tipo, faixa) e o índice não seria criado.

interface ExercicioGravado {
  name?: unknown;
  exerciseId?: unknown;
  slug?: unknown;
}

export interface ResultadoForward {
  total: number;
  atualizadas: number;
  semSlug: number;
  falharam: number;
  usuariosComPrRefeito: number;
}

/** Preenche o slug de cada exercício dos treinos de força. Idempotente. */
export async function backfillForward(): Promise<ResultadoForward> {
  // `.cursor()` e não `.find()`: são todos os treinos de força de todo mundo, e
  // materializar os payloads de uma vez é o que mata o processo no container.
  const cursor = Activity.find({ kind: "strength" }).select("payload").lean().cursor();

  let total = 0;
  let atualizadas = 0;
  let semSlug = 0;
  let falharam = 0;

  for await (const treino of cursor) {
    total++;
    try {
      const payload = treino.payload as { exercises?: ExercicioGravado[] } | undefined;
      const exercicios = payload?.exercises;
      if (!Array.isArray(exercicios)) continue;

      const slugs = exercicios.map((ex) =>
        slugDoExercicio(
          typeof ex?.name === "string" ? ex.name : "",
          typeof ex?.exerciseId === "string" ? ex.exerciseId : null
        )
      );

      if (slugs.every((s) => !s)) {
        // Nenhum exercício identificável. Não grava "" — a ausência diz "não
        // sei", e a string vazia viraria um balaio onde todos os exercícios
        // anônimos dividiriam o mesmo histórico.
        semSlug++;
        continue;
      }

      // Só o que está faltando ou diferente. Reescrever o que já está certo
      // custaria I/O à toa — e `modifiedCount` não avisaria: `$set` em caminho
      // dentro de campo `Mixed` volta como "modificado" mesmo gravando valor
      // idêntico, então a contagem viria inflada e a segunda rodada pareceria
      // ter trabalho a fazer.
      const set: Record<string, string> = {};
      slugs.forEach((slug, i) => {
        if (slug && exercicios[i]?.slug !== slug) set[`payload.exercises.${i}.slug`] = slug;
      });

      if (Object.keys(set).length === 0) continue;

      await Activity.updateOne({ _id: treino._id }, { $set: set });
      atualizadas++;
    } catch (err) {
      // Um treino torto não pode custar a migração dos outros: o payload é
      // `Mixed` e o que está gravado nunca passou pelo zod de hoje.
      falharam++;
      console.error(`[slugs] treino ${String(treino._id)} falhou:`, (err as Error).message);
    }
  }

  // Segunda metade: refaz os recordes, agora chaveados por slug. Precisa rodar
  // para TODO mundo que tem recorde, não só para quem teve treino atualizado —
  // um recorde antigo sem slug continuaria invisível para a chave nova.
  const usuarios = await PersonalRecord.distinct("user");
  for (const user of usuarios) {
    await recomputeUserPRs(user as mongoose.Types.ObjectId);
  }

  // Agora que não há duplicata, o índice único pode passar a ser o do slug.
  await PersonalRecord.syncIndexes();

  return { total, atualizadas, semSlug, falharam, usuariosComPrRefeito: usuarios.length };
}

/**
 * Tira o slug de todo treino de força e refaz os recordes sem ele.
 *
 * Não restaura o índice antigo: o schema é quem o declara, então voltar o
 * índice é voltar o código. O que este rollback garante é que os dados não
 * ficam num meio-termo — sem slug em lugar nenhum, como antes.
 */
export async function backfillRollback(): Promise<{ limpas: number }> {
  const r = await Activity.updateMany(
    { kind: "strength" },
    { $unset: { "payload.exercises.$[].slug": "" } }
  );

  const usuarios = await PersonalRecord.distinct("user");
  for (const user of usuarios) {
    await recomputeUserPRs(user as mongoose.Types.ObjectId);
  }

  return { limpas: r.modifiedCount ?? 0 };
}

// CLI: `tsx src/scripts/backfillExerciseSlugs.ts [--rollback]`
if (process.argv[1]?.includes("backfillExerciseSlugs")) {
  const rollback = process.argv.includes("--rollback");
  connectDB()
    .then(async () => {
      if (rollback) {
        const r = await backfillRollback();
        console.log(`[slugs] rollback: ${r.limpas} treinos sem o campo, recordes refeitos`);
      } else {
        const r = await backfillForward();
        console.log(
          `[slugs] ${r.atualizadas} treinos atualizados, ${r.semSlug} sem exercício identificável, ${r.falharam} com payload torto (de ${r.total}); recordes refeitos para ${r.usuariosComPrRefeito} pessoas`
        );
      }
      await mongoose.disconnect();
    })
    .catch((err) => {
      console.error("[slugs] falhou:", err);
      process.exit(1);
    });
}
