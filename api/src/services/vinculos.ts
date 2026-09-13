import mongoose from "mongoose";
import { HttpError } from "../utils/httpError.js";
import { recontarPatrocinios } from "./patrocinio.js";
import { User, type UserDoc } from "../models/User.js";
import {
  ProfessionalLink,
  type PapelPro,
  type ProfessionalLinkDoc,
} from "../models/ProfessionalLink.js";
import { ProfessionalInvite, gerarCodigoDeConvite } from "../models/ProfessionalInvite.js";
import { createNotification } from "./notifications.js";
import { limiteDeAlunos, temCapacidade } from "./entitlement.js";

// Quem acompanha quem, e com qual permissão.
//
// Uma regra só, num lugar só — a mesma decisão que `activityVisibility.ts`
// tomou para visibilidade de treino, e pelo mesmo motivo: espalhar isto pelas
// rotas é como um profissional acaba vendo o que não devia.

/** Quanto tempo um link de convite vale. */
const DIAS_DE_VALIDADE = 14;

export interface EscopoPedido {
  treinos?: boolean;
  dieta?: boolean;
  medidas?: boolean;
  fotos?: boolean;
}

/** Quantos alunos ativos o profissional tem neste papel. */
export async function quantosAlunos(
  professionalId: mongoose.Types.ObjectId,
  papel: PapelPro
): Promise<number> {
  return ProfessionalLink.countDocuments({
    professional: professionalId,
    papel,
    status: { $in: ["ativo", "pausado"] },
  });
}

/**
 * Cria um link de convite.
 *
 * O teto é conferido aqui E no aceite. Aqui é cortesia — avisa o coach antes de
 * ele mandar o link para alguém e a pessoa levar "não" na cara. No aceite é
 * obrigação, porque entre gerar e aceitar pode passar uma semana e outros
 * alunos podem ter entrado.
 */
export async function gerarConvite(
  professional: UserDoc,
  papel: PapelPro,
  usos = 1,
  /** Quando vem, o convite é endereçado: só esta pessoa pode aceitar. */
  para?: UserDoc | null
): Promise<{ code: string; expiraEm: Date; usosRestantes: number; para: string | null }> {
  if (!temCapacidade(professional, papel)) {
    throw new HttpError(403, "Esta conta não tem acesso profissional.");
  }

  if (para) {
    if (para._id.equals(professional._id)) {
      throw new HttpError(400, "Você não pode convidar a si mesmo.");
    }
    const jaTem = await ProfessionalLink.exists({
      professional: professional._id,
      client: para._id,
      papel,
      status: { $ne: "encerrado" },
    });
    if (jaTem) throw new HttpError(409, "Você já acompanha esta pessoa.");
  }

  const teto = limiteDeAlunos(professional, papel);
  const atuais = await quantosAlunos(professional._id, papel);
  if (atuais >= teto) {
    throw new HttpError(
      409,
      `Você já acompanha ${atuais} de ${teto} alunos. Encerre um acompanhamento para abrir vaga.`
    );
  }

  const code = await gerarCodigoDeConvite();
  const expiraEm = new Date(Date.now() + DIAS_DE_VALIDADE * 24 * 60 * 60 * 1000);
  // O teto também limita quantas pessoas um link só pode trazer: um convite de
  // 50 usos num coach de 10 alunos só geraria frustração na hora do aceite.
  // Convite endereçado é sempre de um uso: ele tem dono.
  const usosRestantes = para ? 1 : Math.max(1, Math.min(usos, teto - atuais));

  const convite = await ProfessionalInvite.create({
    professional: professional._id,
    papel,
    code,
    usosRestantes,
    expiraEm,
    para: para?._id ?? null,
  });

  // O convite endereçado precisa CHEGAR. Sem isto ele seria um código no banco
  // que ninguém vê — e o coach ficaria esperando um aceite que nunca vem.
  //
  // O alvo é o convite, e não o código: `targetId` é ObjectId no modelo, e o
  // app resolve o código na tela de convites recebidos. O APK antigo não sabe
  // o que é `targetKind: "convite"` e simplesmente não navega ao tocar — o
  // texto, que é o que importa, aparece igual.
  if (para) {
    await createNotification({
      userId: para._id,
      actorId: professional._id,
      actorName: professional.name,
      type: "convite_pro",
      text: `${professional.name} quer te acompanhar como ${papel === "coach" ? "treinador" : "nutricionista"}.`,
      targetKind: "convite",
      targetId: convite._id,
    });
  }

  return { code, expiraEm, usosRestantes, para: para?._id.toString() ?? null };
}

export interface ConvitePreview {
  code: string;
  papel: PapelPro;
  profissional: { id: string; nome: string; username: string | null; avatarUrl: string };
  jaVinculado: boolean;
}

/**
 * O que o aluno vê ANTES de aceitar.
 *
 * Existe porque ninguém deve autorizar acesso aos próprios dados de saúde sem
 * saber para quem. A tela de aceite mostra quem é o profissional, e só então
 * pergunta o que abrir.
 */
export async function verConvite(code: string, quem?: mongoose.Types.ObjectId): Promise<ConvitePreview> {
  const convite = await ProfessionalInvite.findOne({ code: code.toUpperCase().trim() });
  if (!convite) throw new HttpError(404, "Convite não encontrado.");
  if (convite.revogadoEm) throw new HttpError(410, "Este convite foi cancelado.");
  if (convite.expiraEm.getTime() < Date.now()) throw new HttpError(410, "Este convite expirou.");
  if (convite.usosRestantes <= 0) throw new HttpError(410, "Este convite já foi usado.");
  // Convite endereçado não é link: quem não é o dono nem fica sabendo de quem
  // era — daí 404 e não 403.
  if (convite.para && quem && !convite.para.equals(quem)) {
    throw new HttpError(404, "Convite não encontrado.");
  }

  const prof = await User.findById(convite.professional).select("name username avatarUrl");
  if (!prof) throw new HttpError(404, "Convite não encontrado.");

  const jaVinculado = quem
    ? Boolean(
        await ProfessionalLink.exists({
          professional: convite.professional,
          client: quem,
          papel: convite.papel,
          status: { $ne: "encerrado" },
        })
      )
    : false;

  return {
    code: convite.code,
    papel: convite.papel as PapelPro,
    profissional: {
      id: prof._id.toString(),
      nome: prof.name,
      username: prof.username ?? null,
      avatarUrl: prof.avatarUrl ?? "",
    },
    jaVinculado,
  };
}

/**
 * O aluno aceita o convite e escolhe o que abrir.
 *
 * O aceite É o consentimento — não existe vínculo sem esta chamada, e é por
 * isso que não há estado "convidado" endereçado a alguém: o convite é um link,
 * e o vínculo só nasce quando o dono dos dados diz sim.
 */
export async function aceitarConvite(
  aluno: UserDoc,
  code: string,
  escopo: EscopoPedido = {}
): Promise<ProfessionalLinkDoc> {
  const convite = await ProfessionalInvite.findOne({ code: code.toUpperCase().trim() });
  if (!convite) throw new HttpError(404, "Convite não encontrado.");
  if (convite.revogadoEm) throw new HttpError(410, "Este convite foi cancelado.");
  if (convite.expiraEm.getTime() < Date.now()) throw new HttpError(410, "Este convite expirou.");
  if (convite.usosRestantes <= 0) throw new HttpError(410, "Este convite já foi usado.");

  if (convite.professional.equals(aluno._id)) {
    throw new HttpError(400, "Você não pode se acompanhar pelo próprio convite.");
  }
  if (convite.para && !convite.para.equals(aluno._id)) {
    throw new HttpError(404, "Convite não encontrado.");
  }

  const professional = await User.findById(convite.professional);
  if (!professional || !temCapacidade(professional, convite.papel as PapelPro)) {
    throw new HttpError(410, "Este profissional não está mais ativo.");
  }

  const papel = convite.papel as PapelPro;

  const existente = await ProfessionalLink.findOne({
    professional: convite.professional,
    client: aluno._id,
    papel,
  });
  // Reaceitar um vínculo encerrado revive o mesmo documento: o índice é único
  // por (profissional, aluno, papel), e o histórico de quando começou e
  // terminou tem valor para os dois lados.
  if (existente && existente.status !== "encerrado") {
    throw new HttpError(409, "Você já é acompanhado por esta pessoa.");
  }

  // O teto vale no momento do aceite, não no da criação do convite: entre um e
  // outro pode ter passado uma semana e outros alunos podem ter entrado.
  const teto = limiteDeAlunos(professional, papel);
  const atuais = await quantosAlunos(professional._id, papel);
  if (atuais >= teto) {
    throw new HttpError(409, "Este profissional já atingiu o limite de alunos.");
  }

  const campos = {
    status: "ativo" as const,
    escopo: {
      treinos: escopo.treinos ?? true,
      dieta: escopo.dieta ?? false,
      medidas: escopo.medidas ?? false,
      fotos: escopo.fotos ?? false,
    },
    convite: convite._id,
    aceitoEm: new Date(),
    encerradoEm: null,
    encerradoPor: null,
  };

  const link = existente
    ? Object.assign(existente, campos)
    : new ProfessionalLink({ professional: convite.professional, client: aluno._id, papel, ...campos });
  await link.save();

  convite.usosRestantes -= 1;
  await convite.save();

  // O aluno passa a ser bancado pelo profissional.
  //
  // É aqui que a promessa "quem paga é o profissional, e o aluno tem o
  // acompanhamento completo" vira verdade no banco. Sem isto, o mentorado
  // ficaria com a evolução de sete dias do plano grátis enquanto o treinador
  // dele vê o ano inteiro no painel.
  //
  // Depois do `save()` do vínculo, de propósito: se a gravação do vínculo
  // falhar, ninguém ganha Pro por um acompanhamento que não existe.
  await recontarPatrocinios(aluno._id);

  return link;
}

/** O aluno muda o que está aberto, a qualquer momento. */
export async function ajustarEscopo(
  aluno: UserDoc,
  linkId: string,
  escopo: EscopoPedido
): Promise<ProfessionalLinkDoc> {
  const link = await ProfessionalLink.findOne({ _id: linkId, client: aluno._id });
  if (!link) throw new HttpError(404, "Acompanhamento não encontrado.");

  // Só mexe no que veio: um PATCH que zera o resto tiraria acesso sem querer.
  for (const chave of ["treinos", "dieta", "medidas", "fotos"] as const) {
    if (escopo[chave] !== undefined) link.set(`escopo.${chave}`, escopo[chave]);
  }
  await link.save();
  return link;
}

/**
 * Encerra o acompanhamento. Os dois lados podem: o aluno sai quando quiser, e
 * o profissional dispensa quem não acompanha mais.
 *
 * O vínculo não é apagado — vira histórico. O acesso, esse acaba na hora.
 */
export async function encerrarVinculo(quem: UserDoc, linkId: string): Promise<ProfessionalLinkDoc> {
  const link = await ProfessionalLink.findById(linkId);
  if (!link) throw new HttpError(404, "Acompanhamento não encontrado.");

  const ehDono = link.client.equals(quem._id) || link.professional.equals(quem._id);
  if (!ehDono) throw new HttpError(403, "Este acompanhamento não é seu.");
  if (link.status === "encerrado") return link;

  link.status = "encerrado";
  link.encerradoEm = new Date();
  link.encerradoPor = quem._id;
  await link.save();

  // Acabou este patrocínio. O aluno volta ao plano dele — que pode continuar
  // sendo Pro, se ele paga ou se outro profissional ainda o acompanha. A
  // recontagem enxerga isso sozinha.
  await recontarPatrocinios(link.client);

  return link;
}

/**
 * O vínculo ativo entre duas pessoas, se houver.
 *
 * É a função que a camada de visibilidade consulta. Devolve o documento (e não
 * um booleano) porque quem pergunta precisa do ESCOPO: ter vínculo não é ter
 * acesso a tudo.
 *
 * ATENÇÃO: entre duas pessoas pode haver DOIS vínculos ativos — o índice único
 * é `{professional, client, papel}`, e a mesma pessoa acompanhando alguém como
 * treinador e como nutricionista é estado legítimo. Sem `papel`, esta função
 * devolve um dos dois sem critério. Quando a pergunta é sobre acesso, use
 * `vinculosAtivos` ou `podeVer`, que olham o escopo.
 */
export async function vinculoAtivo(
  clientId: mongoose.Types.ObjectId,
  professionalId: mongoose.Types.ObjectId,
  papel?: PapelPro
): Promise<ProfessionalLinkDoc | null> {
  if (clientId.equals(professionalId)) return null;
  return ProfessionalLink.findOne({
    client: clientId,
    professional: professionalId,
    status: "ativo",
    ...(papel ? { papel } : {}),
  });
}

/**
 * TODOS os vínculos ativos entre duas pessoas — no máximo um por papel.
 *
 * Existe porque escolher entre eles é decisão de quem pergunta: para ler
 * treino, vale o vínculo que abriu treinos, seja ele de coach ou de nutri;
 * para prescrever, só o de coach serve. Um `findOne` aqui devolvia o vínculo
 * errado e negava acesso a quem tinha — e de forma intermitente, que é a pior
 * maneira de um bug de permissão aparecer.
 */
export async function vinculosAtivos(
  clientId: mongoose.Types.ObjectId,
  professionalId: mongoose.Types.ObjectId
): Promise<ProfessionalLinkDoc[]> {
  if (clientId.equals(professionalId)) return [];
  return ProfessionalLink.find({ client: clientId, professional: professionalId, status: "ativo" });
}

/**
 * Esta pessoa é acompanhada por um profissional deste papel?
 *
 * Diferente de `podeVer`: aqui a pergunta não é sobre acesso, é sobre QUEM
 * responde pelo treino dela. Quem tem treinador não recebe treino da IA —
 * `POST /plans/generate` criaria uma versão nova por cima da prescrição, em
 * silêncio, e a pessoa passaria a seguir um treino que o coach dela nunca viu.
 */
export async function temProfissional(
  clientId: mongoose.Types.ObjectId,
  papel: PapelPro
): Promise<boolean> {
  const link = await ProfessionalLink.findOne({ client: clientId, papel, status: "ativo" }).select("_id");
  return link != null;
}

/** O profissional pode ver esta parte da vida deste aluno? */
export async function podeVer(
  clientId: mongoose.Types.ObjectId,
  professionalId: mongoose.Types.ObjectId,
  parte: "treinos" | "dieta" | "medidas" | "fotos"
): Promise<boolean> {
  if (clientId.equals(professionalId)) return false;
  // Pergunta ao banco por um vínculo que ABRA esta parte, em vez de pegar um
  // vínculo qualquer e olhar o escopo depois: com dois vínculos ativos, o
  // "qualquer" podia ser justo o que não abriu.
  const link = await ProfessionalLink.findOne({
    client: clientId,
    professional: professionalId,
    status: "ativo",
    [`escopo.${parte}`]: true,
  });
  return link != null;
}
