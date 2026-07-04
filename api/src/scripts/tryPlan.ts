/**
 * Teste manual da geração de plano real com o Gemini (Fatia 3).
 * Uso: com GEMINI_API_KEY no .env, rode `npm run try:plan`.
 */
import { env } from "../config/env.js";
import { generatePlan } from "../services/ai/planGenerator.js";
import type { ProfileData } from "../models/Profile.js";

const profile: ProfileData = {
  goal: "perder_gordura",
  sex: "feminino",
  age: 32,
  heightCm: 165,
  weightKg: 78,
  experienceLevel: "iniciante",
  daysPerWeek: 3,
  sessionMinutes: 45,
  dietaryRestrictions: ["carne vermelha"],
  injuriesConditions: ["dor no joelho direito"],
  notes: "",
};

async function main() {
  if (!env.geminiApiKey) {
    console.error("❌ GEMINI_API_KEY não configurada no .env.");
    process.exit(1);
  }
  console.log(`Gerando plano com ${env.geminiModel}…\n`);
  const plan = await generatePlan(profile);
  console.log("📝 Resumo:", plan.summary, "\n");
  console.log("🏋️  Treino:", plan.workout.split, `(${plan.workout.daysPerWeek}x/sem)`);
  for (const s of plan.workout.sessions) {
    console.log(`  • ${s.day} — ${s.focus}: ${s.exercises.map((e) => e.name).join(", ")}`);
  }
  console.log("\n🥗 Dieta:", plan.diet.dailyCalories, "kcal");
  console.log("  Refeições:", plan.diet.meals.map((m) => m.name).join(", "));
  console.log("\n⚠️", plan.disclaimer);
}

main().catch((err) => {
  console.error("Falhou:", err.message ?? err);
  process.exit(1);
});
