import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { SPORTS } from "../services/sports.js";

// Catálogo de esportes para o seletor do app (referência estática).
export const sportsRouter = Router();
sportsRouter.use(requireAuth);

sportsRouter.get("/", (_req, res) => {
  res.json({ data: SPORTS });
});
