import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { PersonalRecord } from "../models/PersonalRecord.js";
import { PersonalRecordEvent } from "../models/PersonalRecordEvent.js";
import { decodeCursor, encodeCursor } from "../utils/cursor.js";
import { calcularPlan } from "../services/entitlement.js";
import { inicioDaJanela } from "../utils/dia.js";

export const prsRouter = Router();
prsRouter.use(requireAuth);

/**
 * Os recordes pessoais (o app agrupa por exercício).
 *
 * Faz parte do Pro. Responde **200 com lista vazia**, e não 402, pelo mesmo
 * motivo do calendário: o aplicativo não intercepta 402 fora da Home, e aqui
 * um erro derrubaria a aba Recordes inteira num `ErrorState` — a pessoa veria
 * "não foi possível carregar", que é mentira. Com `meta.limitadoPor`, o app
 * novo desenha o cadeado e o antigo mostra a lista vazia.
 *
 * A COMEMORAÇÃO ao bater um recorde continua livre, e é de propósito: ela não
 * vem daqui, vem do `newPRs` da resposta de salvar o treino. Quem treina
 * continua sendo celebrado na hora; o que é pago é voltar depois para
 * consultar a marca.
 */
prsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    if (calcularPlan(req.user!) === "free") {
      return res.json({ data: [], meta: { limitadoPor: "plano" } });
    }

    const prs = await PersonalRecord.find({ user: req.user!._id }).sort({ exerciseName: 1, type: 1 });
    res.json({
      data: prs.map((p) => ({
        id: p._id.toString(),
        sportId: p.sportId,
        exerciseName: p.exerciseName,
        exerciseSlug: p.exerciseSlug ?? "",
        type: p.type,
        repRange: p.repRange ?? null,
        value: p.value,
        unit: p.unit,
        achievedAt: p.achievedAt,
        previousValue: p.previousValue ?? null,
        previousAchievedAt: p.previousAchievedAt ?? null,
      })),
    });
  })
);

const historicoSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().optional(),
  /** Só as conquistas de um exercício — o gráfico dele marca estes pontos. */
  slug: z.string().max(80).optional(),
});

/**
 * O histórico de conquistas: cada recorde batido, do mais recente para trás.
 *
 * Separado de `GET /` de propósito. Aquele responde "qual é o meu recorde hoje"
 * e cabe inteiro numa tela; este é uma lista que só cresce, e por isso pagina
 * por cursor, como manda a convenção do projeto.
 */
prsRouter.get(
  "/historico",
  asyncHandler(async (req, res) => {
    const { limit, cursor: raw, slug } = historicoSchema.parse(req.query);
    const cursor = raw ? decodeCursor(raw) : null;

    const filtro: mongoose.FilterQuery<unknown> = { user: req.user!._id };
    if (slug) filtro.exerciseSlug = slug;

    // O grátis vê a última semana de conquistas, como no resto da aba.
    //
    // `GET /prs` — os recordes ATUAIS — fica livre de propósito: a comemoração
    // ao bater um recorde é o laço que faz a pessoa voltar amanhã, e cobrar por
    // ela cortaria o que sustenta o grátis. O que é Pro é rever a linha do
    // tempo inteira.
    const cortado = calcularPlan(req.user!) === "free";
    if (cortado) filtro.achievedAt = { $gte: inicioDaJanela(7) };
    if (cursor) {
      // Keyset por (achievedAt desc, _id desc): o `_id` desempata as conquistas
      // do mesmo instante, que acontecem sempre — um treino bate carga máxima e
      // 1RM estimado na mesma hora.
      filtro.$or = [
        { achievedAt: { $lt: cursor.startedAt } },
        { achievedAt: cursor.startedAt, _id: { $lt: new mongoose.Types.ObjectId(cursor.id) } },
      ];
    }

    const docs = await PersonalRecordEvent.find(filtro)
      .sort({ achievedAt: -1, _id: -1 })
      .limit(limit + 1);

    const temMais = docs.length > limit;
    const itens = temMais ? docs.slice(0, limit) : docs;
    const ultimo = itens[itens.length - 1];
    const nextCursor =
      temMais && ultimo
        ? encodeCursor({ startedAt: ultimo.achievedAt as Date, id: ultimo._id.toString() })
        : null;

    res.json({
      data: itens.map((e) => ({
        id: e._id.toString(),
        sportId: e.sportId,
        exerciseName: e.exerciseName,
        exerciseSlug: e.exerciseSlug,
        type: e.type,
        repRange: e.repRange ?? null,
        value: e.value,
        previousValue: e.previousValue,
        unit: e.unit,
        achievedAt: e.achievedAt,
      })),
      meta: { nextCursor, ...(cortado ? { dias: 7, limitadoPor: "plano" } : {}) },
    });
  })
);
