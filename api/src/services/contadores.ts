import mongoose from "mongoose";
import { Post } from "../models/Post.js";
import { Comment } from "../models/Comment.js";
import { Like } from "../models/Like.js";
import { Cupom } from "../models/Cupom.js";
import { CupomUso } from "../models/CupomUso.js";

// Os contadores desnormalizados, e como devolvê-los à verdade.
//
// `Post.commentCount` e `Post.likeCount` existem para o feed não precisar
// contar em cada linha. O preço é que eles podem divergir, e divergiram: o
// `commentCount` só INCREMENTAVA. Não havia caminho nenhum que o diminuísse —
// nem no app (não existe apagar um comentário isolado), nem na moderação (que
// OCULTA o comentário, e a lista filtra `hidden` enquanto o contador não).
//
// Isso ficou invisível até alguém apagar um comentário pelo CRUD de coleções e
// a foto continuar dizendo "3 comentários" com dois na tela.
//
// A regra daqui: RECONTAR, nunca ajustar por delta. Uma recontagem chega no
// número certo venha de onde vier — e é a única operação segura de repetir
// quando não se sabe o que já foi aplicado.

/** Recalcula os contadores de UM post. Idempotente. */
export async function reconciliarPost(postId: mongoose.Types.ObjectId | string): Promise<void> {
  const _id = typeof postId === "string" ? new mongoose.Types.ObjectId(postId) : postId;

  const [comentarios, curtidas] = await Promise.all([
    // `hidden` fora da conta, para o número bater com a LISTA — que filtra
    // `hidden: { $ne: true }`. Um contador que diverge da lista que ele
    // resume é pior que contador nenhum.
    Comment.countDocuments({ post: _id, hidden: { $ne: true } }),
    Like.countDocuments({ post: _id }),
  ]);

  await Post.updateOne({ _id }, { $set: { commentCount: comentarios, likeCount: curtidas } });
}

/** Recalcula o contador de usos de um cupom. */
export async function reconciliarCupom(codigo: string): Promise<void> {
  const usos = await CupomUso.countDocuments({ cupom: codigo.toUpperCase() });
  await Cupom.updateOne({ codigo: codigo.toUpperCase() }, { $set: { usos } });
}

/**
 * O que precisa ser recontado depois de mexer num documento.
 *
 * Existe porque o CRUD de coleções apaga o documento e mais nada — ele não
 * roda a lógica de negócio que manteria os contadores. Sem este mapa, apagar
 * um comentário pela tela deixaria a foto dizendo que tem um comentário a
 * mais, para sempre.
 */
export async function reconciliarDependentes(
  colecao: string,
  documento: Record<string, unknown>
): Promise<string | null> {
  switch (colecao) {
    case "Comment":
    case "Like": {
      const post = documento.post;
      if (!post) return null;
      await reconciliarPost(String(post));
      return "Contagem do post recalculada.";
    }
    case "CupomUso": {
      const cupom = documento.cupom;
      if (typeof cupom !== "string") return null;
      await reconciliarCupom(cupom);
      return "Contagem de usos do cupom recalculada.";
    }
    default:
      return null;
  }
}

/**
 * Varre TODOS os contadores e conserta o que estiver errado.
 *
 * Para o estrago que já existe — os contadores que cresceram sem nunca
 * diminuir. Devolve quantos estavam errados, e não só quantos foram
 * visitados: "1200 posts conferidos" não diz nada, "3 estavam errados" diz.
 *
 * Em lotes, e não tudo em memória: a coleção de posts cresce, e uma varredura
 * que carrega tudo funciona até o dia em que para de funcionar.
 */
export async function reconciliarTudo(): Promise<{
  postsConferidos: number;
  postsCorrigidos: number;
  cuponsConferidos: number;
  cuponsCorrigidos: number;
}> {
  let postsConferidos = 0;
  let postsCorrigidos = 0;

  const LOTE = 200;
  let cursor: mongoose.Types.ObjectId | null = null;

  for (;;) {
    const filtro: Record<string, unknown> = {};
    if (cursor) filtro._id = { $gt: cursor };
    const posts = await Post.find(filtro)
      .select("_id commentCount likeCount")
      .sort({ _id: 1 })
      .limit(LOTE);
    if (posts.length === 0) break;

    for (const p of posts) {
      const [comentarios, curtidas] = await Promise.all([
        Comment.countDocuments({ post: p._id, hidden: { $ne: true } }),
        Like.countDocuments({ post: p._id }),
      ]);
      postsConferidos += 1;
      if ((p.commentCount ?? 0) !== comentarios || (p.likeCount ?? 0) !== curtidas) {
        await Post.updateOne(
          { _id: p._id },
          { $set: { commentCount: comentarios, likeCount: curtidas } }
        );
        postsCorrigidos += 1;
      }
    }
    cursor = posts[posts.length - 1]!._id;
  }

  let cuponsConferidos = 0;
  let cuponsCorrigidos = 0;
  const cupons = await Cupom.find({}).select("codigo usos");
  for (const c of cupons) {
    const usos = await CupomUso.countDocuments({ cupom: c.codigo });
    cuponsConferidos += 1;
    if ((c.usos ?? 0) !== usos) {
      await Cupom.updateOne({ _id: c._id }, { $set: { usos } });
      cuponsCorrigidos += 1;
    }
  }

  return { postsConferidos, postsCorrigidos, cuponsConferidos, cuponsCorrigidos };
}
