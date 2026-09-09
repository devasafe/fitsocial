import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { panorama } from "../../services/growthMetrics.js";
import { FUSO } from "../../utils/dia.js";

export const adminMetricsRouter = Router();

/** Tudo que o dashboard mostra, numa chamada só. */
adminMetricsRouter.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const dias = Math.min(Math.max(Number(req.query.dias) || 30, 7), 180);
    const iniciado = Date.now();
    const dados = await panorama(dias);

    res.json({
      data: dados,
      // tookMs existe para medir quando a agregação ao vivo deixar de servir.
      // Enquanto estiver na casa das dezenas de ms, pré-agregar seria
      // complexidade sem motivo.
      meta: { dias, fuso: FUSO, tookMs: Date.now() - iniciado },
    });
  })
);
