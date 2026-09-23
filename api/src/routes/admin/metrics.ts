import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { panorama } from "../../services/growthMetrics.js";
import { funilDePercurso } from "../../services/funil.js";
import { FUSO } from "../../utils/dia.js";

export const adminMetricsRouter = Router();

/** Janela pedida, presa entre uma semana e meio ano. */
function janela(bruto: unknown): number {
  return Math.min(Math.max(Number(bruto) || 30, 7), 180);
}

/** Tudo que o dashboard mostra, numa chamada só. */
adminMetricsRouter.get(
  "/overview",
  asyncHandler(async (req, res) => {
    const dias = janela(req.query.dias);
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

/** Onde as pessoas param, degrau a degrau. */
adminMetricsRouter.get(
  "/funil",
  asyncHandler(async (req, res) => {
    const dias = janela(req.query.dias);
    const iniciado = Date.now();
    const degraus = await funilDePercurso(dias);

    const total = degraus[0]?.pessoas ?? 0;

    // A passagem é medida contra o último degrau que teve gente, e não contra o
    // imediatamente anterior. Quando um degrau vem zerado — porque a versão do
    // app instalada ainda não manda aquele evento — o anterior imediato seria
    // zero, e a conta devolveria 0% para todos os degraus abaixo, apagando
    // justamente a informação que se foi buscar.
    let ultimoComGente = total;

    const comTaxas = degraus.map((d) => {
      const doPasso = ultimoComGente > 0 ? Math.round((d.pessoas / ultimoComGente) * 100) : 0;
      if (d.pessoas > 0) ultimoComGente = d.pessoas;
      return {
        ...d,
        doTotal: total > 0 ? Math.round((d.pessoas / total) * 100) : 0,
        doPasso,
      };
    });

    res.json({
      data: { degraus: comTaxas },
      meta: { dias, fuso: FUSO, tookMs: Date.now() - iniciado },
    });
  })
);
