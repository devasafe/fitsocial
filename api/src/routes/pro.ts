import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requirePro } from "../middleware/pro.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { User } from "../models/User.js";
import { Activity } from "../models/Activity.js";
import { ProfessionalInvite } from "../models/ProfessionalInvite.js";
import { ProfessionalLink, PAPEIS_PRO, type PapelPro } from "../models/ProfessionalLink.js";
import { limiteDeAlunos } from "../services/entitlement.js";
import {
  aceitarConvite,
  ajustarEscopo,
  encerrarVinculo,
  gerarConvite,
  quantosAlunos,
  verConvite,
  vinculoAtivo,
} from "../services/vinculos.js";
import { calendarioDoUsuario, exerciciosDoUsuario } from "../services/evolucao.js";
import { computeStats } from "../services/adherence.js";

export const proRouter = Router();
proRouter.use(requireAuth);

// O painel profissional, e o lado do aluno que responde a ele.
//
// As duas metades vivem no mesmo arquivo porque são a mesma conversa vista de
// cada lado — mas têm guardas diferentes: o profissional passa por
// `requirePro`, e o aluno só precisa estar logado. Aceitar um convite é coisa
// de aluno; ninguém precisa ser coach para ser acompanhado por um.

const papelSchema = z.enum(PAPEIS_PRO);
const escopoSchema = z.object({
  treinos: z.boolean().optional(),
  dieta: z.boolean().optional(),
  medidas: z.boolean().optional(),
  fotos: z.boolean().optional(),
});

// ---------------------------------------------------------------- profissional

/** Quem sou eu como profissional: capacidades, teto e quanto já usei. */
proRouter.get(
  "/me",
  requirePro("coach", "nutri"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const capacidades = await Promise.all(
      PAPEIS_PRO.map(async (papel) => ({
        papel,
        ativo: user.pro?.[papel]?.ativo === true,
        limite: limiteDeAlunos(user, papel),
        alunos: await quantosAlunos(user._id, papel),
      }))
    );
    res.json({ data: { capacidades: capacidades.filter((c) => c.ativo) }, meta: {} });
  })
);

const novoConviteSchema = z.object({
  papel: papelSchema,
  // Um link para um aluno é o caso normal; mais de um serve para a turma toda.
  usos: z.number().int().min(1).max(50).default(1),
});

proRouter.post(
  "/convites",
  requirePro("coach", "nutri"),
  rateLimit({ windowMs: 60_000, max: 10, name: "pro-convite" }),
  asyncHandler(async (req, res) => {
    const { papel, usos } = novoConviteSchema.parse(req.body);
    const convite = await gerarConvite(req.user!, papel, usos);
    res.status(201).json({ data: convite, meta: {} });
  })
);

/** Os convites que ainda valem, para o profissional reenviar ou cancelar. */
proRouter.get(
  "/convites",
  requirePro("coach", "nutri"),
  asyncHandler(async (req, res) => {
    const convites = await ProfessionalInvite.find({
      professional: req.user!._id,
      revogadoEm: null,
      expiraEm: { $gt: new Date() },
      usosRestantes: { $gt: 0 },
    }).sort({ createdAt: -1 });

    res.json({
      data: convites.map((c) => ({
        code: c.code,
        papel: c.papel,
        usosRestantes: c.usosRestantes,
        expiraEm: c.expiraEm,
      })),
      meta: {},
    });
  })
);

proRouter.delete(
  "/convites/:code",
  requirePro("coach", "nutri"),
  asyncHandler(async (req, res) => {
    const convite = await ProfessionalInvite.findOne({
      code: String(req.params.code).toUpperCase().trim(),
      professional: req.user!._id,
    });
    if (!convite) throw new HttpError(404, "Convite não encontrado.");

    convite.revogadoEm = new Date();
    await convite.save();
    res.json({ data: { code: convite.code, revogado: true }, meta: {} });
  })
);

/**
 * A lista de alunos — a tela inicial do painel.
 *
 * Traz junto o que o profissional precisa para decidir em quem tocar hoje:
 * quando a pessoa treinou pela última vez e quantas vezes na semana. Sem isso
 * a lista seria só nomes, e ele teria de abrir um por um para descobrir quem
 * sumiu.
 */
proRouter.get(
  "/alunos",
  requirePro("coach", "nutri"),
  asyncHandler(async (req, res) => {
    const papel = req.query.papel ? papelSchema.parse(req.query.papel) : undefined;

    const links = await ProfessionalLink.find({
      professional: req.user!._id,
      status: { $ne: "encerrado" },
      ...(papel ? { papel } : {}),
    })
      .sort({ aceitoEm: -1 })
      .populate("client", "name username avatarUrl");

    const semanaAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const data = await Promise.all(
      links.map(async (link) => {
        const cliente = link.client as unknown as {
          _id: mongoose.Types.ObjectId;
          name: string;
          username?: string;
          avatarUrl?: string;
        };

        // Só quem abriu os treinos entra com número; para os outros, a lista
        // mostra o vínculo e diz que não há acesso, em vez de mentir zero.
        const podeTreinos = link.escopo?.treinos === true;
        const [ultimo, naSemana] = podeTreinos
          ? await Promise.all([
              Activity.findOne({ user: cliente._id }).sort({ startedAt: -1 }).select("startedAt"),
              Activity.countDocuments({ user: cliente._id, startedAt: { $gte: semanaAtras } }),
            ])
          : [null, 0];

        return {
          id: link._id.toString(),
          papel: link.papel,
          status: link.status,
          escopo: link.escopo,
          desde: link.aceitoEm,
          aluno: {
            id: cliente._id.toString(),
            nome: cliente.name,
            username: cliente.username ?? null,
            avatarUrl: cliente.avatarUrl ?? "",
          },
          treinos: podeTreinos ? { ultimoEm: ultimo?.startedAt ?? null, naSemana } : null,
        };
      })
    );

    res.json({ data, meta: { total: data.length, limite: limiteDeAlunos(req.user!, papel ?? "coach") } });
  })
);

/**
 * O aluno por dentro: o que ele autorizou, e nada além.
 *
 * A rota devolve 403 quando o escopo de treinos está fechado, em vez de
 * devolver a página vazia — a diferença entre "não treinou" e "não me deixou
 * ver" é exatamente o que o profissional precisa saber.
 */
proRouter.get(
  "/alunos/:id",
  requirePro("coach", "nutri"),
  asyncHandler(async (req, res) => {
    const alunoId = z.string().parse(req.params.id);
    if (!mongoose.isValidObjectId(alunoId)) throw new HttpError(404, "Aluno não encontrado.");

    const clientId = new mongoose.Types.ObjectId(alunoId);
    const link = await vinculoAtivo(clientId, req.user!._id);
    if (!link) throw new HttpError(404, "Este não é seu aluno.");
    if (link.escopo?.treinos !== true) {
      throw new HttpError(403, "Este aluno não abriu os treinos para você.");
    }

    const aluno = await User.findById(clientId).select("name username avatarUrl bio");
    if (!aluno) throw new HttpError(404, "Aluno não encontrado.");

    const dias = z.coerce.number().int().min(7).max(365).default(90).parse(req.query.dias);

    const [exercicios, calendario, datas] = await Promise.all([
      exerciciosDoUsuario(clientId, dias),
      calendarioDoUsuario(clientId, Math.min(dias, 365)),
      Activity.find({ user: clientId }).select("startedAt").sort({ startedAt: -1 }).limit(400),
    ]);

    res.json({
      data: {
        aluno: {
          id: aluno._id.toString(),
          nome: aluno.name,
          username: aluno.username ?? null,
          avatarUrl: aluno.avatarUrl ?? "",
          bio: aluno.bio ?? "",
        },
        vinculo: { id: link._id.toString(), papel: link.papel, escopo: link.escopo, desde: link.aceitoEm },
        // A mesma conta de sequência que o aluno vê na Home dele: os dois lados
        // precisam ver o mesmo número, senão a conversa começa com discordância.
        constancia: computeStats(datas.map((a) => ({ date: a.startedAt }))),
        exercicios,
        calendario,
      },
      meta: { dias },
    });
  })
);

/** O profissional dispensa um aluno. */
proRouter.delete(
  "/alunos/:linkId",
  requirePro("coach", "nutri"),
  asyncHandler(async (req, res) => {
    const link = await encerrarVinculo(req.user!, String(req.params.linkId));
    res.json({ data: { id: link._id.toString(), status: link.status }, meta: {} });
  })
);

// ----------------------------------------------------------------------- aluno

/** O que o convite é, antes de aceitar. Só exige estar logado. */
proRouter.get(
  "/convites/:code",
  asyncHandler(async (req, res) => {
    const preview = await verConvite(String(req.params.code), req.user!._id);
    res.json({ data: preview, meta: {} });
  })
);

proRouter.post(
  "/convites/:code/aceitar",
  rateLimit({ windowMs: 60_000, max: 20, name: "pro-aceitar" }),
  asyncHandler(async (req, res) => {
    const escopo = escopoSchema.parse(req.body ?? {});
    const link = await aceitarConvite(req.user!, String(req.params.code), escopo);
    res.status(201).json({
      data: { id: link._id.toString(), papel: link.papel, escopo: link.escopo, status: link.status },
      meta: {},
    });
  })
);

/** Quem me acompanha — a tela onde o aluno vê e controla os acessos. */
proRouter.get(
  "/acompanhamentos",
  asyncHandler(async (req, res) => {
    const links = await ProfessionalLink.find({ client: req.user!._id, status: { $ne: "encerrado" } })
      .sort({ aceitoEm: -1 })
      .populate("professional", "name username avatarUrl");

    res.json({
      data: links.map((l) => {
        const p = l.professional as unknown as {
          _id: mongoose.Types.ObjectId;
          name: string;
          username?: string;
          avatarUrl?: string;
        };
        return {
          id: l._id.toString(),
          papel: l.papel as PapelPro,
          escopo: l.escopo,
          desde: l.aceitoEm,
          profissional: {
            id: p._id.toString(),
            nome: p.name,
            username: p.username ?? null,
            avatarUrl: p.avatarUrl ?? "",
          },
        };
      }),
      meta: {},
    });
  })
);

/** O aluno muda o que está aberto. */
proRouter.patch(
  "/acompanhamentos/:id",
  asyncHandler(async (req, res) => {
    const escopo = escopoSchema.parse(req.body ?? {});
    const link = await ajustarEscopo(req.user!, String(req.params.id), escopo);
    res.json({ data: { id: link._id.toString(), escopo: link.escopo }, meta: {} });
  })
);

/** O aluno sai. */
proRouter.delete(
  "/acompanhamentos/:id",
  asyncHandler(async (req, res) => {
    const link = await encerrarVinculo(req.user!, String(req.params.id));
    res.json({ data: { id: link._id.toString(), status: link.status }, meta: {} });
  })
);
