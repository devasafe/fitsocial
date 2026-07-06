import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { uploadsRouter, UPLOADS_DIR } from "./routes/uploads.js";
import { authRouter } from "./routes/auth.js";
import { onboardingRouter } from "./routes/onboarding.js";
import { plansRouter } from "./routes/plans.js";
import { socialRouter } from "./routes/social.js";
import { checkinsRouter } from "./routes/checkins.js";
import { gamificationRouter } from "./routes/gamification.js";
import { coachRouter } from "./routes/coach.js";
import { billingRouter } from "./routes/billing.js";
import { exerciseVideosRouter } from "./routes/exerciseVideos.js";
import { errorHandler } from "./middleware/error.js";

/** Monta a aplicação Express (sem subir o servidor) — facilita os testes. */
export function createApp() {
  const app = express();

  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true }));

  // Servir e receber imagens (GET estático + POST de upload no mesmo caminho).
  app.use("/uploads", express.static(UPLOADS_DIR));
  app.use("/uploads", uploadsRouter);

  app.use("/auth", authRouter);
  app.use("/onboarding", onboardingRouter);
  app.use("/plans", plansRouter);
  app.use("/social", socialRouter);
  app.use("/checkins", checkinsRouter);
  app.use("/gamification", gamificationRouter);
  app.use("/coach", coachRouter);
  app.use("/billing", billingRouter);
  app.use("/exercise-videos", exerciseVideosRouter);

  // Rota não encontrada.
  app.use((_req, res) => res.status(404).json({ error: "Rota não encontrada" }));

  app.use(errorHandler);
  return app;
}
