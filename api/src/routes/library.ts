import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { searchExercises } from "../services/exercisesCatalog.js";
import { searchWods } from "../services/wodBenchmarks.js";

// Bibliotecas de referência para autocomplete (exercícios, WODs benchmark).
export const libraryRouter = Router();
libraryRouter.use(requireAuth);

libraryRouter.get("/exercises", (req, res) => {
  const q = String(req.query.q ?? "");
  res.json({ data: searchExercises(q) });
});

libraryRouter.get("/wods", (req, res) => {
  const q = String(req.query.q ?? "");
  res.json({ data: searchWods(q) });
});
