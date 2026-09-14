import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/admin.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { adminSessionRouter } from "./session.js";
import { adminAiRouter } from "./ai.js";
import { adminUsersRouter } from "./users.js";
import { adminMetricsRouter } from "./metrics.js";
import { adminReportsRouter } from "./reports.js";
import { adminCuponsRouter } from "./cupons.js";
import { adminDadosRouter } from "./dados.js";

export const adminRouter = Router();

// Entrar no painel é público (protegido por rate limit) — o resto, não.
adminRouter.use("/session", adminSessionRouter);

adminRouter.use(requireAuth, requireAdmin);

/** Quem sou eu — o painel chama no boot para validar a sessão. */
adminRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const u = req.user!;
    res.json({
      data: { id: u._id.toString(), name: u.name, email: u.email, role: u.role },
      meta: {},
    });
  })
);

adminRouter.use("/ai", adminAiRouter);
adminRouter.use("/users", adminUsersRouter);
adminRouter.use("/metrics", adminMetricsRouter);
adminRouter.use("/reports", adminReportsRouter);
adminRouter.use("/cupons", adminCuponsRouter);
// Acesso direto as colecoes. Ver o comentario em dados.ts: existe porque o
// Mongo nao esta exposto na internet, e nao deve estar.
adminRouter.use("/dados", adminDadosRouter);
