import { Router } from "express";
import { env } from "../config/env.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { avisarSequenciasEmRisco } from "../services/lembretes.js";

/**
 * O gatilho do lembrete noturno, para um agendador de fora chamar.
 *
 * Este projeto não tem cron nem worker, e isso é escolha, não falta: um
 * `setInterval` no boot vira processo de fundo invisível e manda o aviso
 * duplicado no dia em que houver duas instâncias. Uma rota protegida mantém o
 * disparo explícito, auditável e fácil de rodar à mão quando preciso.
 *
 * Fica fora de `/admin` de propósito: quem chama é uma máquina, não uma pessoa
 * logada no painel.
 */
export const lembretesRouter = Router();

lembretesRouter.post(
  "/sequencia",
  // Teto baixo: é uma chamada por noite. Qualquer coisa além disso é engano ou
  // alguém tentando usar a rota como megafone.
  rateLimit({ windowMs: 60_000, max: 4, name: "lembrete-sequencia" }),
  asyncHandler(async (req, res) => {
    const token = env.lembretesToken;
    // Sem segredo configurado, a rota não funciona para ninguém.
    if (!token || req.get("x-lembretes-token") !== token) {
      throw new HttpError(401, "Não autorizado");
    }

    const r = await avisarSequenciasEmRisco();
    res.json({ data: r, meta: {} });
  })
);
