import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import {
  normalizeExerciseName,
  resolveExerciseVideo,
  type ResolvedVideo,
} from "../services/exerciseVideo.js";

export const exerciseVideosRouter = Router();
exerciseVideosRouter.use(requireAuth);

const resolveSchema = z.object({
  names: z.array(z.string().min(1)).min(1).max(60),
});

// Resolve a sessão inteira de uma vez. Deduplica por nome e resolve em paralelo.
exerciseVideosRouter.post(
  "/resolve",
  rateLimit({ windowMs: 60_000, max: 30, name: "exercise-videos" }),
  asyncHandler(async (req, res) => {
    const parsed = resolveSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "Envie uma lista de nomes de exercícios (1 a 60).");
    }
    const { names } = parsed.data;

    // Deduplica pela chave NORMALIZADA, e não pelo texto cru.
    //
    // "Agachamento" e "agachamento" são o mesmo exercício e caem na mesma
    // entrada do cache (`normalizedName`, único no modelo). Deduplicando pelo
    // texto cru, as duas grafias viravam duas resoluções disparadas EM
    // PARALELO pela mesma chave: duas buscas no YouTube pelo mesmo vídeo, e
    // duas gravações correndo uma contra a outra — quem ganhasse a corrida
    // decidia se sobrava um documento ou dois. O desperdício acontecia sempre;
    // a duplicata, só às vezes, que é o pior jeito de um defeito aparecer.
    const primeiraGrafia = new Map<string, string>();
    for (const n of names) {
      const chave = normalizeExerciseName(n);
      if (chave && !primeiraGrafia.has(chave)) primeiraGrafia.set(chave, n);
    }

    const chaves = [...primeiraGrafia.keys()];
    const resolvidos = await Promise.all(
      [...primeiraGrafia.values()].map((n) => resolveExerciseVideo(n))
    );
    const porChave = new Map<string, ResolvedVideo>();
    chaves.forEach((chave, i) => porChave.set(chave, resolvidos[i]));

    // A resposta continua vindo pelo nome que o app mandou: deduplicar é
    // detalhe daqui, e não pode mudar o contrato de quem chama.
    const videos: Record<string, ResolvedVideo> = {};
    for (const n of names) videos[n] = porChave.get(normalizeExerciseName(n)) ?? null;

    res.json({ videos });
  })
);
