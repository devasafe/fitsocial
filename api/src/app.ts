import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { uploadsRouter } from "./routes/uploads.js";
import { UPLOADS_DIR } from "./services/storage/disk.js";
import { authRouter } from "./routes/auth.js";
import { onboardingRouter } from "./routes/onboarding.js";
import { plansRouter } from "./routes/plans.js";
import { socialRouter } from "./routes/social.js";
import { activitiesRouter } from "./routes/activities.js";
import { sportsRouter } from "./routes/sports.js";
import { prsRouter } from "./routes/prs.js";
import { evolucaoRouter } from "./routes/evolucao.js";
import { proRouter } from "./routes/pro.js";
import { libraryRouter } from "./routes/library.js";
import { challengesRouter } from "./routes/challenges.js";
import { nutritionRouter } from "./routes/nutrition.js";
import { waterRouter } from "./routes/water.js";
import { notificationsRouter } from "./routes/notifications.js";
import { readStateRouter } from "./routes/readState.js";
import { pushRouter } from "./routes/push.js";
import { checkinsRouter } from "./routes/checkins.js";
import { gamificationRouter } from "./routes/gamification.js";
import { coachRouter } from "./routes/coach.js";
import { billingRouter } from "./routes/billing.js";
import { exerciseVideosRouter } from "./routes/exerciseVideos.js";
import { adminRouter } from "./routes/admin/index.js";
import { errorHandler } from "./middleware/error.js";

/** Monta a aplicação Express (sem subir o servidor) — facilita os testes. */
export function createApp() {
  const app = express();

  // A API roda atrás do proxy do Coolify (Traefik). Sem isto, req.ip é sempre o
  // IP do proxy: o rate limit por IP viraria um balde único para o mundo todo,
  // e qualquer um trancaria o login do painel para todos. "1" = um único hop
  // confiável; mais que isso permitiria forjar X-Forwarded-For.
  app.set("trust proxy", 1);

  app.use(cors({ origin: env.corsOrigins.includes("*") ? "*" : env.corsOrigins }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true }));

  // Servir e receber imagens (GET estático + POST de upload no mesmo caminho).
  app.use("/uploads", express.static(UPLOADS_DIR));
  app.use("/uploads", uploadsRouter);

  app.use("/auth", authRouter);
  app.use("/onboarding", onboardingRouter);
  app.use("/plans", plansRouter);
  app.use("/social", socialRouter);
  app.use("/activities", activitiesRouter);
  app.use("/sports", sportsRouter);
  app.use("/prs", prsRouter);
  app.use("/evolucao", evolucaoRouter);
  app.use("/pro", proRouter);
  app.use("/library", libraryRouter);
  app.use("/challenges", challengesRouter);
  app.use("/nutrition", nutritionRouter);
  app.use("/water", waterRouter);
  app.use("/notifications", notificationsRouter);
  app.use("/read-state", readStateRouter);
  app.use("/push", pushRouter);
  app.use("/checkins", checkinsRouter);
  app.use("/gamification", gamificationRouter);
  app.use("/coach", coachRouter);
  app.use("/billing", billingRouter);
  app.use("/exercise-videos", exerciseVideosRouter);

  // Painel administrativo (domínio próprio; exige sessão de escopo admin).
  app.use("/admin", adminRouter);

  // Rota não encontrada.
  app.use((_req, res) => res.status(404).json({ error: "Rota não encontrada" }));

  app.use(errorHandler);
  return app;
}
