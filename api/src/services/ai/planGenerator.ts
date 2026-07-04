import { getAIProvider, parseJson, type AIProvider } from "./index.js";
import {
  TRAINING_KNOWLEDGE,
  NUTRITION_KNOWLEDGE,
  SAFETY_DISCLAIMER,
} from "./knowledgeBase.js";
import { planDataSchema, type PlanData } from "../../models/Plan.js";
import type { ProfileData } from "../../models/Profile.js";

function buildSystemPrompt(): string {
  return `Você é o coach do FitSocial, que acumula os papéis de personal trainer e nutricionista. Gere um plano de TREINO e DIETA personalizado, em português do Brasil, seguindo ESTRITAMENTE os princípios abaixo.

${TRAINING_KNOWLEDGE}

${NUTRITION_KNOWLEDGE}

REGRAS:
- Baseie TODO o plano na ficha do usuário fornecida.
- Respeite rigorosamente as restrições alimentares e lesões/condições informadas.
- O treino deve caber nos dias e minutos por sessão disponíveis.
- "summary" deve ser uma mensagem curta e motivadora explicando a estratégia.
- "disclaimer" deve ser exatamente: "${SAFETY_DISCLAIMER}"

Responda SOMENTE com um JSON válido neste formato (sem texto fora do JSON):
{
  "summary": "string",
  "workout": {
    "split": "string",
    "daysPerWeek": number,
    "sessions": [
      { "day": "string", "focus": "string",
        "exercises": [ { "name": "string", "sets": number, "reps": "string", "restSeconds": number, "notes": "string" } ] }
    ]
  },
  "diet": {
    "dailyCalories": number,
    "macros": { "proteinG": number, "carbsG": number, "fatG": number },
    "meals": [ { "name": "string", "timeHint": "string", "items": [ { "food": "string", "quantity": "string" } ] } ],
    "notes": "string"
  },
  "disclaimer": "string"
}`;
}

function buildUserPrompt(profile: ProfileData): string {
  return `Ficha do usuário:
- Objetivo: ${profile.goal}
- Sexo: ${profile.sex}
- Idade: ${profile.age} anos
- Altura: ${profile.heightCm} cm
- Peso: ${profile.weightKg} kg
- Nível de experiência: ${profile.experienceLevel}
- Dias por semana disponíveis: ${profile.daysPerWeek}
- Minutos por sessão: ${profile.sessionMinutes}
- Restrições alimentares: ${profile.dietaryRestrictions.join(", ") || "nenhuma"}
- Lesões/condições: ${profile.injuriesConditions.join(", ") || "nenhuma"}
- Observações: ${profile.notes || "nenhuma"}

Gere o plano completo de treino e dieta para esta pessoa.`;
}

/** Gera um plano (treino + dieta) validado a partir da ficha do usuário. */
export async function generatePlan(
  profile: ProfileData,
  provider: AIProvider = getAIProvider()
): Promise<PlanData> {
  const raw = await provider.generate({
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: buildUserPrompt(profile) }],
    jsonMode: true,
    temperature: 0.5,
  });

  return parseJson(raw, planDataSchema);
}
