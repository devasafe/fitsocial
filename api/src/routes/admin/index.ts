import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/admin.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { adminSessionRouter } from "./session.js";
import { adminAiRouter } from "./ai.js";
import { adminUsersRouter } from "./users.js";

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
