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
  pessoasComFalha: number;
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

      // Conta o que GRAVOU. `updateOne` pode voltar sem ter gravado e sem
      // lancar, e um relatorio de migracao que mente e pior que nenhum.
      const r = await Activity.updateOne({ _id: treino._id }, { $set: set });
      if (r.modifiedCount) atualizadas++;
    } catch (err) {
      // Um treino torto não pode custar a migração dos outros: o payload é
      // `Mixed` e o que está gravado nunca passou pelo zod de hoje.
      falharam++;
      console.error(`[slugs] treino ${String(treino._id)} falhou:`, (err as Error).message);
    }
  }

  // O índice ANTIGO sai antes do recompute, não depois.
  //
  // Ele é único por `exerciseName`, e o recompute regrava os recordes com a
  // grafia mais recente: dois exercícios que convergem para o mesmo slug podem
  // colidir nele no meio do caminho e abortar a migração — deixando parte das
  // pessoas com os recordes já refeitos e parte não.
  await PersonalRecord.collection
    .dropIndex("user_1_exerciseName_1_type_1_repRange_1")
    .catch(() => undefined);

  // Segunda metade: refaz os recordes, agora chaveados por slug. Precisa rodar
  // para TODO mundo que tem recorde, não só para quem teve treino atualizado —
  // um recorde antigo sem slug continuaria invisível para a chave nova.
  const usuarios = await PersonalRecord.distinct("user");
  let pessoasComFalha = 0;
  for (const user of usuarios) {
    try {
      await recomputeUserPRs(user as mongoose.Types.ObjectId);
    } catch (err) {
      // Uma pessoa não pode custar a migração das outras. E o estado dela é
      // recuperável: `npm run pr:recompute` refaz só ela depois.
      pessoasComFalha++;
      console.error(`[slugs] recordes de ${String(user)} falharam:`, (err as Error).message);
    }
  }

  // O indice novo, e so ele. `syncIndexes()` derrubaria qualquer indice que
  // nao esteja no schema — inclusive algum criado a mao em producao para
  // resolver um problema pontual. A intencao aqui e estreita: trocar um indice
  // por outro, e e isso que o codigo deve dizer.
  await PersonalRecord.createIndexes();

  return {
    total,
    atualizadas,
    semSlug,
    falharam,
    usuariosComPrRefeito: usuarios.length - pessoasComFalha,
    pessoasComFalha,
  };
}

/**
 * Tira o slug de todo treino de força, derruba o índice novo e refaz os
 * recordes sem ele.
 *
 * Derrubar o índice é parte do rollback, e não detalhe: `autoIndex` só CRIA
 * índice, nunca remove. Voltar o código para a versão anterior deixaria o
 * índice único por slug vivo na coleção, e o código antigo — que não escreve
 * `exerciseSlug` — colidiria em (user, null, tipo, faixa) no segundo recorde
 * de qualquer pessoa. O rollback precisa desfazer o que o forward fez.
 */
export async function backfillRollback(): Promise<{ limpas: number }> {
  // O filtro so pega quem tem o campo, por dois motivos: o operador `$[]` erra
  // no primeiro documento cujo `payload.exercises` nao seja array — e existe
  // payload torto, tanto que o forward envolve cada treino em try/catch — e
  // assim `modifiedCount` passa a significar alguma coisa.
  const r = await Activity.updateMany(
    { kind: "strength", "payload.exercises.slug": { $exists: true } },
    { $unset: { "payload.exercises.$[].slug": "" } }
  );

  await PersonalRecord.collection
    .dropIndex("user_1_exerciseSlug_1_type_1_repRange_1")
    .catch(() => undefined);

  const usuarios = await PersonalRecord.distinct("user");
  for (const user of usuarios) {
    try {
      await recomputeUserPRs(user as mongoose.Types.ObjectId);
    } catch (err) {
      console.error(`[slugs] rollback dos recordes de ${String(user)} falhou:`, (err as Error).message);
    }
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
          `[slugs] ${r.atualizadas} treinos atualizados, ${r.semSlug} sem exercício identificável, ${r.falharam} com payload torto (de ${r.total}); recordes refeitos para ${r.usuariosComPrRefeito} pessoas` +
            (r.pessoasComFalha > 0
              ? `; ${r.pessoasComFalha} pessoa(s) falharam — rode 'npm run pr:recompute' depois`
              : "")
        );
      }
      await mongoose.disconnect();
    })
    .catch((err) => {
      console.error("[slugs] falhou:", err);
      process.exit(1);
    });
}
