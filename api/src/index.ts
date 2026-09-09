import { createApp } from "./app.js";
import { connectDB } from "./config/db.js";
import { env } from "./config/env.js";
import { installAiTelemetry } from "./services/aiUsage.js";

async function main() {
  await connectDB();
  installAiTelemetry(); // só depois do banco: o sink grava direto no Mongo
  const app = createApp();
  app.listen(env.port, () => {
    console.log(`[api] FitSocial rodando em http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  console.error("[api] Falha ao iniciar:", err);
  process.exit(1);
});
