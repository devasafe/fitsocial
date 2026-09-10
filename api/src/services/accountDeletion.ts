import type { UserDoc } from "../models/User.js";
import { User } from "../models/User.js";
import { Profile } from "../models/Profile.js";
import { Plan } from "../models/Plan.js";
import { Activity } from "../models/Activity.js";
import { WorkoutLog } from "../models/WorkoutLog.js";
import { FoodLog } from "../models/FoodLog.js";
import { WaterLog } from "../models/WaterLog.js";
import { PersonalRecord } from "../models/PersonalRecord.js";
import { CoachMessage } from "../models/CoachMessage.js";
import { AiUsage } from "../models/AiUsage.js";
import { Post } from "../models/Post.js";
import { Comment } from "../models/Comment.js";
import { Like } from "../models/Like.js";
import { Follow } from "../models/Follow.js";
import { Notification } from "../models/Notification.js";
import { Report } from "../models/Report.js";
import { ReadState } from "../models/ReadState.js";
import { PushDevice, PushCooldown } from "../models/PushDevice.js";
import { UserDailyActive } from "../models/UserDailyActive.js";
import { Challenge } from "../models/Challenge.js";
import { ChallengeMember } from "../models/ChallengeMember.js";
import {
  ChallengePost,
  ChallengePostComment,
  ChallengePostLike,
} from "../models/ChallengePost.js";
import { getStorageProvider } from "./storage/index.js";
import { HttpError } from "../utils/httpError.js";

/**
 * Exclusão de conta a pedido da pessoa (LGPD, art. 18, VI).
 *
 * A regra que orienta tudo aqui: **o que é da pessoa é apagado de verdade**.
 * Nada de `deletedAt` na conta, nada de "desativado mas guardado" — isso é
 * exatamente o que a lei chama de tratamento continuado, e é o que a pessoa
 * está pedindo para acabar.
 *
 * Duas coisas sobrevivem, e cada uma tem um motivo que não é conveniência:
 *
 * - **`AdminAudit`**: o registro de que um administrador baniu, removeu ou
 *   olhou a ficha de alguém. É prestação de contas sobre o que a plataforma
 *   fez, não sobre quem a pessoa é, e já guarda o e-mail mascarado. Apagar
 *   permitiria a um admin encobrir a própria ação excluindo a conta olhada.
 *
 * - **Desafio criado que tem outras pessoas dentro**: apagar levaria junto o
 *   histórico de gente que não pediu nada. O desafio fica; o criador vira uma
 *   referência que não resolve mais, e nenhuma tela mostra o nome dele (o
 *   `creator` nunca é populado).
 *
 * O que NÃO sobrevive, e costuma ser esquecido: a foto de perfil no
 * armazenamento. Conta apagada com selfie ainda acessível na CDN não é conta
 * apagada.
 */

export interface ResumoDaExclusao {
  /** Quantos documentos saíram, por coleção. Só o que teve alguma remoção. */
  removidos: Record<string, number>;
  /** Desafios que continuaram de pé porque tinham outras pessoas. */
  desafiosPreservados: number;
  fotoRemovida: boolean;
}

export async function excluirConta(user: UserDoc): Promise<ResumoDaExclusao> {
  // Um admin que se autoexclui deixa o painel sem dono e leva embora a própria
  // trilha de responsabilidade. Sai pela mão de outro admin, nunca sozinho.
  if (user.role === "admin") {
    throw new HttpError(
      403,
      "Contas de administrador não são excluídas por aqui. Fale com outro administrador."
    );
  }

  const id = user._id;
  const removidos: Record<string, number> = {};

  const conta = async (nome: string, promessa: Promise<{ deletedCount?: number }>) => {
    const r = await promessa;
    if (r.deletedCount) removidos[nome] = r.deletedCount;
  };

  // ---- Desafios criados: decide antes de apagar as inscrições ----
  const criados = await Challenge.find({ creator: id }).select("_id");
  let desafiosPreservados = 0;
  for (const desafio of criados) {
    const outros = await ChallengeMember.countDocuments({
      challenge: desafio._id,
      user: { $ne: id },
    });
    if (outros > 0) {
      desafiosPreservados += 1;
      continue;
    }
    // Ninguém além dela: o desafio inteiro era dela.
    await ChallengeMember.deleteMany({ challenge: desafio._id });
    await ChallengePost.deleteMany({ challenge: desafio._id });
    await Challenge.deleteOne({ _id: desafio._id });
    removidos.desafios = (removidos.desafios ?? 0) + 1;
  }

  // ---- Treino, saúde e uso: nada disso faz sentido sem a pessoa ----
  await Promise.all([
    conta("ficha", Profile.deleteMany({ user: id })),
    conta("planos", Plan.deleteMany({ user: id })),
    conta("atividades", Activity.deleteMany({ user: id })),
    conta("treinos", WorkoutLog.deleteMany({ user: id })),
    conta("refeicoes", FoodLog.deleteMany({ user: id })),
    conta("agua", WaterLog.deleteMany({ user: id })),
    conta("recordes", PersonalRecord.deleteMany({ user: id })),
    conta("conversasComOCoach", CoachMessage.deleteMany({ user: id })),
    conta("usoDeIa", AiUsage.deleteMany({ user: id })),
    conta("presenca", UserDailyActive.deleteMany({ user: id })),
    conta("marcasDeLeitura", ReadState.deleteMany({ user: id })),
    conta("aparelhos", PushDevice.deleteMany({ user: id })),
    conta("janelasDePush", PushCooldown.deleteMany({ user: id })),
  ]);

  // ---- Social ----
  await Promise.all([
    conta("posts", Post.deleteMany({ author: id })),
    conta("comentarios", Comment.deleteMany({ author: id })),
    conta("curtidas", Like.deleteMany({ user: id })),
    // Os dois lados: quem ela seguia e quem a seguia.
    conta("seguindo", Follow.deleteMany({ $or: [{ follower: id }, { following: id }] })),
    // Tanto as que ela recebeu quanto as que ela causou em outras pessoas: uma
    // notificação "Fulano curtiu seu post" continua nomeando alguém que pediu
    // para sumir.
    conta("notificacoes", Notification.deleteMany({ $or: [{ user: id }, { actor: id }] })),
    // Denúncias que ela fez. O que aconteceu com o conteúdo denunciado continua
    // registrado no AdminAudit, então nada de prestação de contas se perde.
    conta("denunciasFeitas", Report.deleteMany({ reporter: id })),
    conta("postsDeDesafio", ChallengePost.deleteMany({ author: id })),
    conta("comentariosDeDesafio", ChallengePostComment.deleteMany({ author: id })),
    conta("curtidasDeDesafio", ChallengePostLike.deleteMany({ user: id })),
    conta("inscricoesEmDesafios", ChallengeMember.deleteMany({ user: id })),
  ]);

  // ---- A foto ----
  let fotoRemovida = false;
  if (user.avatarUrl) {
    try {
      await getStorageProvider().delete(user.avatarUrl);
      fotoRemovida = true;
    } catch (err) {
      // Não trava a exclusão: um arquivo órfão é problema menor que uma conta
      // que a pessoa pediu para apagar e continuou de pé.
      console.warn(`[conta] não deu para remover a foto: ${(err as Error).message}`);
    }
  }

  // ---- E a conta. Por último: se algo acima falhar, ela ainda existe para
  // tentar de novo, em vez de virar um monte de dados sem dono. ----
  await User.deleteOne({ _id: id });
  removidos.conta = 1;

  return { removidos, desafiosPreservados, fotoRemovida };
}
