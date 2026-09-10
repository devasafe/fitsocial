import mongoose from "mongoose";
import { Post } from "../models/Post.js";
import { Notification } from "../models/Notification.js";
import { Report } from "../models/Report.js";
import { createNotification } from "./notifications.js";
import { HttpError } from "../utils/httpError.js";
import type { UserDoc } from "../models/User.js";

// Editar e excluir post. A regra de quem pode o quê mora aqui, num lugar só —
// a rota só traduz para HTTP.

/** Só o autor edita, e só o texto.
 *
 *  Trocar a imagem depois de curtidas e comentários muda aquilo que as pessoas
 *  endossaram: vira outra publicação com o histórico social da anterior. Quem
 *  quer outra foto publica de novo. */
export async function editarPost(
  autor: UserDoc,
  postId: string,
  texto: string
): Promise<InstanceType<typeof Post>> {
  if (!mongoose.isValidObjectId(postId)) throw new HttpError(400, "Id inválido");

  const post = await Post.findById(postId);
  if (!post || post.deletedAt) throw new HttpError(404, "Post não encontrado");
  if (!post.author.equals(autor._id)) {
    throw new HttpError(403, "Você só pode editar os seus próprios posts");
  }

  const limpo = texto.trim();
  // Um post pode ser só foto ou só treino; esvaziar o texto de um post que não
  // tem mais nada o deixaria em branco na tela.
  if (!limpo && !post.imageUrl && !post.activity) {
    throw new HttpError(400, "O post ficaria vazio. Escreva algo ou exclua a publicação.");
  }

  post.text = limpo;
  post.editedAt = new Date();
  await post.save();
  return post;
}

export interface ResultadoDaExclusao {
  notificacoesRemovidas: number;
  denunciasAtualizadas: number;
}

/**
 * Exclui um post. Autor ou administrador.
 *
 * A linha não é apagada: uma denúncia em análise precisa do conteúdo, e
 * curtidas e comentários que apontam para cá precisam de um destino que
 * responda "não está mais disponível". Para quem usa, é exclusão — o post some
 * de todas as listas no mesmo instante.
 *
 * Curtidas e comentários NÃO são apagados junto: se a exclusão for revertida
 * por engano de moderação, a conversa volta inteira.
 */
export async function excluirPost(
  quem: UserDoc,
  postId: string,
  opcoes: { comoAdmin?: boolean } = {}
): Promise<ResultadoDaExclusao> {
  if (!mongoose.isValidObjectId(postId)) throw new HttpError(400, "Id inválido");

  const post = await Post.findById(postId);
  if (!post || post.deletedAt) throw new HttpError(404, "Post não encontrado");

  const ehAutor = post.author.equals(quem._id);
  const ehAdmin = opcoes.comoAdmin && quem.role === "admin";
  if (!ehAutor && !ehAdmin) {
    throw new HttpError(403, "Você só pode excluir os seus próprios posts");
  }

  post.deletedAt = new Date();
  post.deletedBy = quem._id;
  await post.save();

  // As notificações que levavam a este post não têm mais para onde levar.
  const notifs = await Notification.deleteMany({ targetKind: "post", targetId: post._id });

  // Denúncias pendentes sobre ele já têm resposta: o conteúdo saiu do ar.
  const denuncias = await Report.updateMany(
    { targetKind: "post", targetId: post._id, status: { $in: ["pendente", "analisando"] } },
    {
      $set: {
        status: "resolvida",
        decision: "removido",
        resolvedBy: quem._id,
        resolvedAt: new Date(),
      },
    }
  );

  // Quem apagou o próprio post sabe que apagou. Quem teve o post removido pela
  // moderação, não — e descobrir sozinho que o conteúdo sumiu é pior do que ser
  // avisado. Vai sem ator: dizer QUAL administrador decidiu transforma uma
  // decisão da plataforma em briga com uma pessoa.
  //
  // Depois da limpeza acima de propósito: aquele deleteMany apaga tudo que
  // aponta para este post, e levaria este aviso junto.
  if (!ehAutor) {
    await createNotification({
      userId: post.author,
      type: "post_removido",
      text: "Sua publicação foi removida por não seguir as regras da comunidade.",
    });
  }

  return {
    notificacoesRemovidas: notifs.deletedCount ?? 0,
    denunciasAtualizadas: denuncias.modifiedCount ?? 0,
  };
}
