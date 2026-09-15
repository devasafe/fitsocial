import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { calcularPlan } from "../services/entitlement.js";
import { janelaPermitida, metaDaJanela } from "../services/janela.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  METRICAS,
  METRICAS_CARDIO,
  calendarioDoUsuario,
  cardioDoUsuario,
  exerciciosDoUsuario,
  gruposDoUsuario,
  menorEhMelhor,
  serieDeCardio,
  serieDoExercicio,
} from "../services/evolucao.js";

export const evolucaoRouter = Router();
evolucaoRouter.use(requireAuth);
// São quatro agregações com `$unwind` duplo. O teto é folgado para o uso real
// (abrir a aba e trocar de janela dispara poucas por minuto) e existe para uma
// tela em laço de recarga não varrer o histórico da pessoa sem parar.
evolucaoRouter.use(rateLimit({ windowMs: 60_000, max: 60, name: "evolucao" }));

// A aba Progresso. Rotas finas: quem sabe de evolução é `services/evolucao.ts`.
//
// A janela é sempre explícita e sempre limitada. O endpoint antigo
// (`GET /checkins/progress`) lia a vida inteira da pessoa a cada abertura da
// aba, e era só uma questão de tempo até isso doer.

/** Janela em dias. Zero é "tudo"; o teto existe para ninguém pedir a vida toda
 *  por engano numa query solta.
 *
 *  O `preprocess` trata `?dias=` vazio como ausente: `Number("")` é 0, e 0 aqui
 *  significa "tudo" — um parâmetro vazio viraria, em silêncio, uma varredura do
 *  histórico inteiro. */
const janelaSchema = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.coerce.number().int().min(0).max(3650).default(90)
);

/** O slug vem da URL, e a borda é onde tudo é validado neste projeto. */
const slugSchema = z.string().min(1).max(80);

const serieSchema = z.object({
  dias: janelaSchema,
  metrica: z.enum(METRICAS).default("carga_max"),
});

/** Os exercícios treinados na janela, com quanto mudaram. */
evolucaoRouter.get(
  "/exercicios",
  asyncHandler(async (req, res) => {
    const pedidos = janelaSchema.parse(req.query.dias);
    const dias = janelaPermitida(req.user!, pedidos);
    const exercicios = await exerciciosDoUsuario(req.user!._id, dias);
    res.json({ data: exercicios, meta: { ...metaDaJanela(pedidos, dias), total: exercicios.length } });
  })
);

/** A série de um exercício ao longo do tempo. */
evolucaoRouter.get(
  "/exercicios/:slug",
  asyncHandler(async (req, res) => {
    const { dias: pedidos, metrica } = serieSchema.parse(req.query);
    const dias = janelaPermitida(req.user!, pedidos);
    const slug = slugSchema.parse(req.params.slug);
    const pontos = await serieDoExercicio(req.user!._id, slug, dias, metrica);
    res.json({ data: pontos, meta: { ...metaDaJanela(pedidos, dias), metrica, slug } });
  })
);

const serieDeCardioSchema = z.object({
  dias: janelaSchema,
  metrica: z.enum(METRICAS_CARDIO).default("pace"),
});

/**
 * Os esportes de cardio praticados na janela.
 *
 * Separado de `/exercicios` porque a unidade é outra: na força se compara
 * exercício com exercício, no cardio se compara corrida com corrida. Juntar os
 * dois numa lista só daria um seletor onde "Supino reto" e "Corrida de rua"
 * disputam a mesma linha sem ter o que comparar.
 */
evolucaoRouter.get(
  "/cardio",
  asyncHandler(async (req, res) => {
    const pedidos = janelaSchema.parse(req.query.dias);
    const dias = janelaPermitida(req.user!, pedidos);
    const esportes = await cardioDoUsuario(req.user!._id, dias);
    res.json({ data: esportes, meta: { ...metaDaJanela(pedidos, dias), total: esportes.length } });
  })
);

/** A curva de um esporte de cardio ao longo do tempo. */
evolucaoRouter.get(
  "/cardio/:sportId",
  asyncHandler(async (req, res) => {
    const { dias: pedidos, metrica } = serieDeCardioSchema.parse(req.query);
    const dias = janelaPermitida(req.user!, pedidos);
    const sportId = slugSchema.parse(req.params.sportId);
    const pontos = await serieDeCardio(req.user!._id, sportId, dias, metrica);
    res.json({
      data: pontos,
      // `menorEhMelhor` viaja com a resposta para o gráfico não precisar saber
      // que pace é o caso especial: quem desenha recebe a instrução pronta.
      meta: {
        ...metaDaJanela(pedidos, dias),
        metrica,
        sportId,
        menorEhMelhor: menorEhMelhor(metrica),
      },
    });
  })
);

/** Séries por grupo muscular — os eixos do radar. */
evolucaoRouter.get(
  "/grupos",
  asyncHandler(async (req, res) => {
    const pedidos = janelaSchema.parse(req.query.dias);
    const dias = janelaPermitida(req.user!, pedidos);
    const grupos = await gruposDoUsuario(req.user!._id, dias);
    res.json({ data: grupos, meta: metaDaJanela(pedidos, dias) });
  })
);

/**
 * Treinos por dia, para o calendário de constância.
 *
 * É a única parte da aba que o grátis não vê em versão reduzida: o calendário
 * existe para mostrar o ANO, e sete casinhas não mostram constância nenhuma —
 * meio calendário pareceria defeito, não limite.
 *
 * Mas responde **200 com lista vazia**, e não 402. O aplicativo não tem
 * interceptor de 402 (só o `handleGenerate` da Home lê esse status), então um
 * 402 aqui chegaria como erro em toda tela instalada e o card "Seu ano" sumiria
 * calado — indistinguível de "você nunca treinou", sem caminho para assinar.
 * Com 200 e `meta.limitadoPor`, o aplicativo novo desenha o cadeado e o antigo
 * degrada sem nenhuma exceção em voo. É o mesmo princípio do corte de janela:
 * limitar, nunca recusar.
 */
evolucaoRouter.get(
  "/calendario",
  asyncHandler(async (req, res) => {
    if (calcularPlan(req.user!) === "free") {
      return res.json({ data: [], meta: { dias: 0, limitadoPor: "plano" } });
    }

    // Aqui a janela precisa ser um número de dias de verdade: o calendário
    // desenha uma casinha por dia, e "tudo" não tem quantas casinhas desenhar.
    const dias = z
      .preprocess(
        (v) => (v === "" || v == null ? undefined : v),
        z.coerce.number().int().min(1).max(730).default(365)
      )
      .parse(req.query.dias);
    const calendario = await calendarioDoUsuario(req.user!._id, dias);
    res.json({ data: calendario, meta: { dias } });
  })
);
