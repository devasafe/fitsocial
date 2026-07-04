import { createApp } from "./app.js";
import { connectDB } from "./config/db.js";
import { env } from "./config/env.js";

async function main() {
  await connectDB();
  const app = createApp();
  app.listen(env.port, () => {
    console.log(`[api] FitSocial rodando em http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  console.error("[api] Falha ao iniciar:", err);
  process.exit(1);
});
