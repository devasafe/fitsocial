import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { usagePorChave, usagePorDia } from "../../services/aiUsage.js";

export const adminAiRouter = Router();

/** Série diária de consumo, para o gráfico do painel. */
adminAiRouter.get(
  "/usage",
  asyncHandler(async (req, res) => {
    const dias = Math.min(Math.max(Number(req.query.dias) || 30, 1), 180);
    const serie = await usagePorDia(dias);
    res.json({ data: serie, meta: { dias } });
  })
);

/** Consumo de hoje por chave, contra o teto configurado em AI_DAILY_LIMITS. */
adminAiRouter.get(
  "/keys",
  asyncHandler(async (_req, res) => {
    const chaves = await usagePorChave();
    res.json({
      data: chaves.map((c) => ({
        ...c,
        // Sem teto configurado não há percentual — melhor null do que fingir 0%.
        usoPct: c.limiteDiario ? Math.round((c.chamadas / c.limiteDiario) * 100) : null,
      })),
      meta: { janela: "hoje (UTC)" },
    });
  })
);
