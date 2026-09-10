import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { contadores, marcarVisto, ehArea } from "../services/readState.js";
import { AREAS } from "../models/ReadState.js";

export const readStateRouter = Router();
readStateRouter.use(requireAuth);

// Quantas novidades há em cada área. Uma chamada só: o app pinta todos os
// badges de uma vez, em vez de cada tela descobrir a sua.
readStateRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ data: await contadores(req.user!._id) });
  })
);

// Marcar como visto devolve os contadores já atualizados — assim o app não
// precisa de uma segunda chamada só para descobrir que o badge sumiu.
readStateRouter.post(
  "/:area",
  asyncHandler(async (req, res) => {
    const area = req.params.area;
    if (!ehArea(area)) {
      throw new HttpError(400, `Área desconhecida. Use uma de: ${AREAS.join(", ")}`);
    }
    await marcarVisto(req.user!._id, area);
    res.json({ data: await contadores(req.user!._id) });
  })
);
