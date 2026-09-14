import mongoose from "mongoose";
import { Activity } from "../models/Activity.js";
import { WorkoutLog } from "../models/WorkoutLog.js";
import { PersonalRecord } from "../models/PersonalRecord.js";
import { PersonalRecordEvent } from "../models/PersonalRecordEvent.js";
import { Post } from "../models/Post.js";
import { type UserDoc } from "../models/User.js";
import { recordAudit, maskEmail } from "./adminAudit.js";

// Apagar o histórico de treino de uma pessoa, sem apagar a pessoa.
//
// É a ÚNICA exclusão em massa do painel, e existe porque o caso é real: uma
// conta que importou tudo errado, ou que pediu para começar de novo. Fazer
// isso documento por documento pela tela de Dados seria dezenas de cliques —
// e cada clique é uma chance de apagar o de outra pessoa.
//
// O que a torna aceitável não é a confirmação na tela: é o escopo ser FIXO no
// código. Não há filtro que quem usa possa escrever, então não há filtro que
// possa estar errado. O único parâmetro é de quem.

/**
 * O que existe hoje, para dizer o tamanho antes de apagar.
 *
 * "Vai apagar 47 treinos e 12 recordes" é uma informação com que se decide;
 * "tem certeza?" não é.
 */
export async function contarTreinos(userId: mongoose.Types.ObjectId): Promise<{
  atividades: number;
  exercicios: number;
  recordes: number;
  postsComTreino: number;
}> {
  const [atividades, exercicios, recordes, postsComTreino] = await Promise.all([
    Activity.countDocuments({ user: userId }),
    WorkoutLog.countDocuments({ user: userId }),
    PersonalRecord.countDocuments({ user: userId }),
    Post.countDocuments({ author: userId, activity: { $ne: null, $exists: true } }),
  ]);
  return { atividades, exercicios, recordes, postsComTreino };
}

/**
 * Apaga treinos, exercícios e recordes. NÃO apaga posts.
 *
 * Os recordes vão junto porque são DERIVADOS dos treinos: deixar um recorde de
 * 120 kg sem o treino que o gerou é pior que não apagar nada — a tela mostraria
 * um número que não tem de onde vir, e a pessoa não teria como contestar.
 *
 * Os POSTS ficam. Eles são conteúdo social, com curtidas e comentários de
 * outras pessoas, e apagar o que os outros disseram não é o que "zerar meus
 * treinos" pede. O que acontece com eles é perderem o cartão do treino: o
 * campo é limpo, para o post não ficar apontando para um documento que não
 * existe mais.
 *
 * `FoodLog` e `WaterLog` também ficam: diário de comida e de água não é
 * treino, e quem pediu para zerar o treino não pediu para esquecer o que
 * comeu.
 */
export async function zerarTreinos(
  ator: UserDoc,
  alvo: UserDoc,
  motivo: string
): Promise<{
  atividades: number;
  exercicios: number;
  recordes: number;
  eventosDeRecorde: number;
  postsDesvinculados: number;
}> {
  const id = alvo._id;

  const [atividades, exercicios, recordes, eventosDeRecorde] = await Promise.all([
    Activity.deleteMany({ user: id }),
    WorkoutLog.deleteMany({ user: id }),
    PersonalRecord.deleteMany({ user: id }),
    PersonalRecordEvent.deleteMany({ user: id }),
  ]);

  // O post fica, mas para de apontar para um treino apagado.
  //
  // `serializePost` já tolera a ausência (devolve `null` no cartão e o post
  // vira um post comum), então nada quebra de qualquer forma — mas referência
  // morta no banco é o tipo de coisa que confunde quem for depurar daqui a
  // seis meses.
  const posts = await Post.updateMany(
    { author: id, activity: { $exists: true } },
    { $unset: { activity: "" } }
  );

  const resumo = {
    atividades: atividades.deletedCount ?? 0,
    exercicios: exercicios.deletedCount ?? 0,
    recordes: recordes.deletedCount ?? 0,
    eventosDeRecorde: eventosDeRecorde.deletedCount ?? 0,
    postsDesvinculados: posts.modifiedCount ?? 0,
  };

  await recordAudit({
    actor: ator,
    action: "user.zerarTreinos",
    targetKind: "user",
    targetId: id,
    // Nunca o e-mail inteiro no registro: `docs/SECURITY.md`.
    targetLabel: maskEmail(alvo.email),
    reason: motivo,
    // As CONTAGENS, e não os documentos. Guardar dezenas de treinos no log
    // encheria a auditoria e não ajudaria — reconstruir um histórico de treino
    // a partir de um diff não é uma operação que alguém vá fazer. O que
    // importa registrar é o tamanho do que se perdeu.
    after: { documento: JSON.stringify(resumo) },
  });

  return resumo;
}
