import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  METRICAS,
  calendarioDoUsuario,
  exerciciosDoUsuario,
  gruposDoUsuario,
  serieDoExercicio,
} from "../services/evolucao.js";

export const evolucaoRouter = Router();
evolucaoRouter.use(requireAuth);

// A aba Progresso. Rotas finas: quem sabe de evolução é `services/evolucao.ts`.
//
// A janela é sempre explícita e sempre limitada. O endpoint antigo
// (`GET /checkins/progress`) lia a vida inteira da pessoa a cada abertura da
// aba, e era só uma questão de tempo até isso doer.

/** Janela em dias. Zero é "tudo"; o teto existe para ninguém pedir a vida toda
 *  por engano numa query solta. */
const janelaSchema = z.coerce.number().int().min(0).max(3650).default(90);

const serieSchema = z.object({
  dias: janelaSchema,
  metrica: z.enum(METRICAS).default("carga_max"),
});

/** Os exercícios treinados na janela, com quanto mudaram. */
evolucaoRouter.get(
  "/exercicios",
  asyncHandler(async (req, res) => {
    const dias = janelaSchema.parse(req.query.dias);
    const exercicios = await exerciciosDoUsuario(req.user!._id, dias);
    res.json({ data: exercicios, meta: { dias, total: exercicios.length } });
  })
);

/** A série de um exercício ao longo do tempo. */
evolucaoRouter.get(
  "/exercicios/:slug",
  asyncHandler(async (req, res) => {
    const { dias, metrica } = serieSchema.parse(req.query);
    const pontos = await serieDoExercicio(req.user!._id, req.params.slug, dias, metrica);
    res.json({ data: pontos, meta: { dias, metrica, slug: req.params.slug } });
  })
);

/** Séries por grupo muscular — os eixos do radar. */
evolucaoRouter.get(
  "/grupos",
  asyncHandler(async (req, res) => {
    const dias = janelaSchema.parse(req.query.dias);
    const grupos = await gruposDoUsuario(req.user!._id, dias);
    res.json({ data: grupos, meta: { dias } });
  })
);

/** Treinos por dia, para o calendário de constância. */
evolucaoRouter.get(
  "/calendario",
  asyncHandler(async (req, res) => {
    // Aqui a janela precisa ser um número de dias de verdade: o calendário
    // desenha uma casinha por dia, e "tudo" não tem quantas casinhas desenhar.
    const dias = z.coerce.number().int().min(1).max(730).default(365).parse(req.query.dias);
    const calendario = await calendarioDoUsuario(req.user!._id, dias);
    res.json({ data: calendario, meta: { dias } });
  })
);
