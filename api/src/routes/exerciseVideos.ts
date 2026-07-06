import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { resolveExerciseVideo, type ResolvedVideo } from "../services/exerciseVideo.js";

export const exerciseVideosRouter = Router();
exerciseVideosRouter.use(requireAuth);

const resolveSchema = z.object({
  names: z.array(z.string().min(1)).min(1).max(30),
});

// Resolve a sessão inteira de uma vez. Deduplica por nome e resolve em paralelo.
exerciseVideosRouter.post(
  "/resolve",
  rateLimit({ windowMs: 60_000, max: 30, name: "exercise-videos" }),
  asyncHandler(async (req, res) => {
    const parsed = resolveSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "Envie uma lista de nomes de exercícios (1 a 30).");
    }
    const { names } = parsed.data;

    // Deduplica preservando o nome original; resolve cada nome único uma vez.
    const unique = [...new Set(names)];
    const resolvedList = await Promise.all(unique.map((n) => resolveExerciseVideo(n)));
    const byName = new Map<string, ResolvedVideo>();
    unique.forEach((n, i) => byName.set(n, resolvedList[i]));

    const videos: Record<string, ResolvedVideo> = {};
    for (const n of names) videos[n] = byName.get(n) ?? null;

    res.json({ videos });
  })
);
