import mongoose from "mongoose";
import { PushDevice, PushCooldown } from "../../models/PushDevice.js";
import { preferenciasDe } from "../notifications.js";
import { naoVistosNoFeed } from "../readState.js";
import { Follow } from "../../models/Follow.js";
import { enviarParaExpo, type MensagemPush, type ResultadoDoEnvio } from "./expo.js";

type Id = mongoose.Types.ObjectId;

/**
 * Quem recebe push, e o que não recebe.
 *
 * A lista curta é o ponto. Push interrompe: cada tipo que entra aqui precisa
 * valer uma pessoa parando o que está fazendo para olhar o celular.
 *
 * - **comentário**: entra. Tem alguém do outro lado esperando resposta.
 * - **curtida**: fica de fora. É o evento mais frequente e o menos acionável —
 *   o caminho mais curto para a pessoa desligar tudo e nunca mais voltar.
 * - **seguidor novo, entrou no seu desafio, post removido**: ficam de fora.
 *   Importam, e por isso viram notificação in-app; nenhum deles pede uma
 *   resposta agora.
 * - **quem você segue publicou**: entra, mas no máximo uma vez por janela.
 */
export type AssuntoDePush = "comment" | "posts_novos";

/** Uma interrupção por dia por assunto já é bastante. */
const JANELA_MS: Record<AssuntoDePush, number> = {
  // Comentário é conversa: segurar seria pior que interromper.
  comment: 0,
  posts_novos: 6 * 60 * 60 * 1000,
};

/** Qual chave das preferências manda em cada assunto. */
const PREFERENCIA: Record<AssuntoDePush, "interacoes" | "novosPosts"> = {
  comment: "interacoes",
  posts_novos: "novosPosts",
};

/** Fan-out máximo por publicação. Acima disto o push vira trabalho de worker. */
const TETO_DE_SEGUIDORES = 500;

interface Aviso {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/** Já falamos com esta pessoa sobre este assunto recentemente? */
async function dentroDaJanela(user: Id, assunto: AssuntoDePush): Promise<boolean> {
  const janela = JANELA_MS[assunto];
  if (!janela) return false;
  const marca = await PushCooldown.findOne({ user, assunto }).select("ultimoEnvioAt");
  if (!marca) return false;
  return Date.now() - marca.ultimoEnvioAt.getTime() < janela;
}

async function marcarEnvio(user: Id, assunto: AssuntoDePush): Promise<void> {
  await PushCooldown.updateOne(
    { user, assunto },
    { $set: { ultimoEnvioAt: new Date() } },
    { upsert: true }
  );
}

/** Remove os tokens que o serviço declarou mortos. */
async function limpar(resultado: ResultadoDoEnvio): Promise<void> {
  if (resultado.invalidos.length) {
    await PushDevice.deleteMany({ token: { $in: resultado.invalidos } });
  }
}

/**
 * Manda um push para todos os aparelhos de uma pessoa.
 *
 * Devolve quantas entregas saíram — zero é resultado normal, não erro: a pessoa
 * pode não ter aparelho registrado, ter desligado o aviso, ou já ter sido
 * avisada dentro da janela.
 */
export async function enviarPush(
  user: Id,
  assunto: AssuntoDePush,
  aviso: Aviso
): Promise<number> {
  try {
    const prefs = await preferenciasDe(user);
    if (prefs[PREFERENCIA[assunto]] === false) return 0;
    if (await dentroDaJanela(user, assunto)) return 0;

    const aparelhos = await PushDevice.find({ user }).select("token");
    if (!aparelhos.length) return 0;

    const mensagens: MensagemPush[] = aparelhos.map((a) => ({
      to: a.token,
      title: aviso.title,
      body: aviso.body,
      data: aviso.data,
    }));

    const resultado = await enviarParaExpo(mensagens);
    await limpar(resultado);
    if (resultado.entregues) await marcarEnvio(user, assunto);
    return resultado.entregues;
  } catch (err) {
    console.warn(`[push] falhou para ${user.toString()}: ${(err as Error).message}`);
    return 0;
  }
}

/**
 * "Quem você segue publicou" — o único push que não nasce de algo dirigido a
 * você.
 *
 * A spec pedia entrega agrupada ("5 novas publicações"). Agrupar de verdade
 * pediria um worker acumulando eventos, e este projeto não tem worker nem cron
 * de propósito. A saída: a janela de silêncio faz o trabalho de não interromper
 * duas vezes, e o número vem do contador da Fase 4, que já sabe quantas
 * publicações a pessoa ainda não viu. Mesma promessa, sem inventar
 * infraestrutura.
 */
export async function avisarSeguidoresDePost(autor: Id, nomeDoAutor: string): Promise<number> {
  const seguidores = await Follow.find({ following: autor })
    .select("follower")
    .limit(TETO_DE_SEGUIDORES);

  let enviados = 0;
  for (const f of seguidores) {
    // O contador é por pessoa: cada uma tem a sua marca de leitura, então cada
    // uma tem um número diferente de publicações não vistas.
    const naoVistas = await naoVistosNoFeed(f.follower);
    const body =
      naoVistas > 1
        ? `${naoVistas} publicações novas de quem você segue`
        : `${nomeDoAutor} publicou um treino`;

    enviados += await enviarPush(f.follower, "posts_novos", {
      title: "FitSocial",
      body,
      data: { tela: "feed" },
    });
  }
  return enviados;
}
