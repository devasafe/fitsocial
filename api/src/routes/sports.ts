import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { SPORTS } from "../services/sports.js";
import { buscarBenchmarks } from "../services/benchmarks.js";

// Catálogo de esportes para o seletor do app (referência estática).
export const sportsRouter = Router();
sportsRouter.use(requireAuth);

sportsRouter.get("/", (_req, res) => {
  res.json({ data: SPORTS });
});

// WODs conhecidos: alimenta o autocomplete e o preenchimento automático da
// prescrição. Estático como o catálogo de esportes — sem consulta ao banco.
sportsRouter.get("/benchmarks", (req, res) => {
  res.json({ data: buscarBenchmarks(String(req.query.q ?? ""), 12) });
});
