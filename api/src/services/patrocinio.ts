import mongoose from "mongoose";
import { User } from "../models/User.js";
import { ProfessionalLink, type PapelPro } from "../models/ProfessionalLink.js";
import { recomputeTier, temCapacidade } from "./entitlement.js";

// Quem banca o Pro de quem.
//
// A regra de produto é uma frase: **o aluno acompanhado tem o acompanhamento
// completo, e quem paga é o profissional**. Sem isto, um mentorado veria sete
// dias de evolução enquanto o treinador dele vê o ano inteiro no painel — o
// oposto do que a plataforma promete, e o oposto do que vende o Pro Coach.
//
// `User.vinculosPatrocinados` é um número desnormalizado, e não uma consulta,
// porque `calcularPlan` roda a cada requisição autenticada e precisa continuar
// sendo função PURA sobre o documento.
//
// RECONTA, não incrementa.
//
// A primeira versão somava e subtraía (`$inc ±1`) nos eventos. Três buracos
// apareceram na revisão, e os três são invisíveis quando acontecem:
//
//   1. renovar o prazo de um coach chamava "retomar" de novo, e somava +1 nos
//      alunos que já estavam somados — conta grátis com Pro vitalício;
//   2. revogar a capacidade e depois encerrar o vínculo descontava o MESMO
//      patrocínio duas vezes, e o aluno perdia o Pro que o nutricionista dele
//      ainda sustentava;
//   3. capacidade que vence sozinha não dispara evento nenhum, então ninguém
//      descontava.
//
// Recontar do zero resolve os três: a operação passa a ser idempotente, e a
// verdade é sempre o que está em `ProfessionalLink` — o contador vira cache
// dela, não um saldo que precisa fechar. O custo é uma consulta por aluno nos
// poucos eventos que mexem em vínculo, em vez de somas cegas.

/**
 * Reconta quantos profissionais bancam este aluno AGORA, e recalcula o plano.
 *
 * "Bancam" exige as duas coisas: vínculo de pé e profissional com a capacidade
 * ativa. Um treinador cuja assinatura venceu mantém os alunos vinculados — de
 * propósito, para não punir quem não deve nada —, mas para de bancá-los.
 */
export async function recontarPatrocinios(clientId: mongoose.Types.ObjectId): Promise<number> {
  const links = await ProfessionalLink.find({
    client: clientId,
    // A mesma lista de `quantosAlunos`: se o aluno pausado ocupa vaga no teto
    // do profissional, ele continua sendo bancado. As duas contas têm de
    // enxergar o mesmo conjunto, senão divergem.
    status: { $in: ["ativo", "pausado"] },
  }).select("professional papel");

  let quantos = 0;
  for (const l of links) {
    const prof = await User.findById(l.professional).select("pro");
    if (prof && temCapacidade(prof, l.papel as PapelPro)) quantos += 1;
  }

  await User.updateOne({ _id: clientId }, { $set: { vinculosPatrocinados: quantos } });

  // Com o documento FRESCO: o que mudou foi no banco, e o plano tem de refletir
  // isso agora — não na próxima vez que a pessoa abrir o app.
  const aluno = await User.findById(clientId);
  if (aluno) await recomputeTier(aluno);

  return quantos;
}

/**
 * Reconta todos os alunos de um profissional.
 *
 * Chamado quando a capacidade dele muda de estado — concedida, revogada,
 * renovada. Uma função só para os dois sentidos, porque recontar não tem
 * sentido: ela chega no número certo venha de onde vier.
 *
 * ATENÇÃO, buraco conhecido: capacidade que VENCE sozinha (`validoAte` no
 * passado) não dispara nada, porque não há cron no projeto. Hoje as
 * capacidades são concedidas à mão e quase sempre sem prazo, então o buraco é
 * teórico. Ele fecha na fase da assinatura, quando o webhook de vencimento
 * passar a chamar esta função.
 */
export async function recontarAlunosDe(
  professionalId: mongoose.Types.ObjectId,
  papel: PapelPro
): Promise<number> {
  const links = await ProfessionalLink.find({
    professional: professionalId,
    papel,
    status: { $in: ["ativo", "pausado"] },
  }).select("client");

  for (const l of links) await recontarPatrocinios(l.client);
  return links.length;
}
