/**
 * Teste manual da integração real com o Gemini (Fatia 2).
 * Uso: coloque GEMINI_API_KEY no .env e rode `npm run try:gemini`.
 * Simula um turno de onboarding e imprime a resposta + ficha extraída.
 */
import { env } from "../config/env.js";
import { runOnboardingTurn } from "../services/ai/onboarding.js";
import type { AIMessage } from "../services/ai/provider.js";

async function main() {
  if (!env.geminiApiKey) {
    console.error("❌ GEMINI_API_KEY não configurada no .env. Pegue uma grátis em https://aistudio.google.com/apikey");
    process.exit(1);
  }
  console.log(`Usando modelo: ${env.geminiModel}\n`);

  // Persona: mulher iniciante que quer perder gordura, com dor no joelho.
  const messages: AIMessage[] = [
    {
      role: "user",
      content:
        "Oi! Meu objetivo é perder gordura. Sou mulher, tenho 32 anos, 1,65m e 78kg. Nunca treinei direito, sou bem sedentária. Consigo treinar 3 dias por semana, umas 45 minutos. Não como carne vermelha. Tenho uma dor no joelho direito.",
    },
  ];

  const turn = await runOnboardingTurn(messages);
  console.log("🗣️  Resposta do coach:\n", turn.reply, "\n");
  console.log("✅ complete:", turn.complete);
  console.log("📋 ficha:\n", JSON.stringify(turn.profile, null, 2));
}

main().catch((err) => {
  console.error("Falhou:", err.message ?? err);
  process.exit(1);
});
