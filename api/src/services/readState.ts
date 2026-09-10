import mongoose from "mongoose";
import { ReadState, AREAS, type Area } from "../models/ReadState.js";
import { Post } from "../models/Post.js";
import { Follow } from "../models/Follow.js";
import { Challenge } from "../models/Challenge.js";
import { ChallengeMember } from "../models/ChallengeMember.js";
import { Notification } from "../models/Notification.js";
import { preferenciasDe } from "./notifications.js";

/** Acima disso o número perde o sentido: o badge mostra "99+". */
export const TETO = 99;

export interface Contadores {
  feed: number;
  explore: number;
  desafios: number;
  notificacoes: number;
}

type Id = mongoose.Types.ObjectId;

/**
 * Primeira vez que alguém pergunta pelos contadores, a marca nasce agora.
 *
 * Sem isso, quem já tinha conta abriria o app no dia do deploy com "99+" em
 * todas as áreas — todo o histórico contaria como novidade. Um badge que grita
 * no primeiro dia é um badge que a pessoa aprende a ignorar.
 *
 * É uma escrita dentro de uma leitura, o que não é bonito, mas acontece uma
 * única vez por pessoa por área.
 */
async function marcasDeLeitura(user: Id): Promise<Record<Area, Date>> {
  const linhas = await ReadState.find({ user }).select("area lastSeenAt");
  const marcas = {} as Record<Area, Date>;
  for (const linha of linhas) marcas[linha.area as Area] = linha.lastSeenAt;

  const faltando = AREAS.filter((a) => !marcas[a]);
  if (faltando.length) {
    const agora = new Date();
    for (const area of faltando) marcas[area] = agora;
    // `ordered: false` para uma corrida entre duas abas abertas não derrubar a
    // inserção inteira: o índice único recusa a segunda, e tudo bem.
    await ReadState.insertMany(
      faltando.map((area) => ({ user, area, lastSeenAt: agora })),
      { ordered: false }
    ).catch(() => {});
  }
  return marcas;
}

/** Parar no teto: ninguém precisa saber que são 4.000, e contar até lá custa. */
const ateOTeto = { limit: TETO + 1 } as const;

export async function contadores(user: Id): Promise<Contadores> {
  const [marcas, seguindo, minhasInscricoes, prefs] = await Promise.all([
    marcasDeLeitura(user),
    Follow.find({ follower: user }).select("following"),
    ChallengeMember.find({ user }).select("challenge"),
    preferenciasDe(user),
  ]);

  // "Novos posts" desligado silencia o badge do Feed, não só um push futuro:
  // aquele badge É o aviso de que quem você segue publicou. Deixar ele aceso
  // faria a chave prometer silêncio e entregar barulho.
  const querSaberDePosts = prefs.novosPosts !== false;

  const seguidos = seguindo.map((f) => f.following);
  const inscritos = minhasInscricoes.map((m) => m.challenge);
  const visivel = { hidden: { $ne: true }, deletedAt: null };

  const [feed, explore, desafios, notificacoes] = await Promise.all([
    // Seguindo: o que quem eu sigo publicou. O meu próprio post não é novidade
    // para mim, então fica fora.
    seguidos.length && querSaberDePosts
      ? Post.countDocuments(
          { author: { $in: seguidos }, createdAt: { $gt: marcas.feed }, ...visivel },
          ateOTeto
        )
      : Promise.resolve(0),

    // Explorar conta só quem eu NÃO sigo. Contar todo mundo faria os mesmos
    // três posts aparecerem em "Seguindo 3" e "Explorar 3" — o badge estaria
    // prometendo seis coisas novas e entregando três.
    Post.countDocuments(
      { author: { $nin: [...seguidos, user] }, createdAt: { $gt: marcas.explore }, ...visivel },
      ateOTeto
    ),

    // Desafio novo é o que dá para entrar: público, ainda aberto, e no qual eu
    // não estou. Convite para algo que já acabou não é novidade, é lixo.
    Challenge.countDocuments(
      {
        visibility: "public",
        endAt: { $gte: new Date() },
        creator: { $ne: user },
        _id: { $nin: inscritos },
        createdAt: { $gt: marcas.desafios },
      },
      ateOTeto
    ),

    // Notificação não usa marca d'água: cada uma já sabe se foi lida.
    Notification.countDocuments({ user, read: false }, ateOTeto),
  ]);

  return { feed, explore, desafios, notificacoes };
}

/** Chamado quando a pessoa chega ao conteúdo que era novo — não ao abrir a aba. */
export async function marcarVisto(user: Id, area: Area): Promise<void> {
  await ReadState.updateOne(
    { user, area },
    { $set: { lastSeenAt: new Date() } },
    { upsert: true }
  );
}

export function ehArea(valor: string): valor is Area {
  return (AREAS as readonly string[]).includes(valor);
}
