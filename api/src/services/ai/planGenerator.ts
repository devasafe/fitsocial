import { getAIProvider, parseJson, type AIProvider } from "./index.js";
import {
  TRAINING_KNOWLEDGE,
  NUTRITION_KNOWLEDGE,
  SAFETY_DISCLAIMER,
} from "./knowledgeBase.js";
import { planDataSchema, type PlanData } from "../../models/Plan.js";
import type { ProfileData } from "../../models/Profile.js";

// Formato JSON do plano, reutilizado nos prompts de geração/importação.
const PLAN_JSON_FORMAT = `{
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

/**
 * Reajusta o plano com base na adesão (treinos feitos + cargas registradas).
 * Aplica progressão de carga/volume para quem está aderindo e simplifica para
 * quem está treinando menos que o planejado.
 */
export async function adjustPlan(
  profile: ProfileData,
  currentPlan: PlanData,
  adherenceSummary: string,
  provider: AIProvider = getAIProvider()
): Promise<PlanData> {
  const userPrompt = `${buildUserPrompt(profile)}

PLANO ATUAL (resumo):
- Treino: ${currentPlan.workout.split} (${currentPlan.workout.daysPerWeek}x/semana)
- Estratégia: ${currentPlan.summary}

${adherenceSummary}

Com base na adesão acima, gere uma NOVA VERSÃO do plano:
- Se a pessoa está treinando bem e progredindo, aplique progressão (aumente carga/reps/volume onde fizer sentido, respeitando o nível).
- Se está treinando MENOS que o planejado, simplifique (reduza dias/volume) para caber na rotina real e evitar frustração.
- Mantenha o mesmo formato JSON de plano. Explique o ajuste no campo "summary".`;

  const raw = await provider.generate({
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: userPrompt }],
    jsonMode: true,
    temperature: 0.5,
  });

  return parseJson(raw, planDataSchema);
}

/**
 * Estrutura o plano que o usuário já tem (feito por um profissional) a partir
 * de texto livre, convertendo-o para o formato do app SEM inventar conteúdo.
 */
export async function importPlanFromText(
  text: string,
  profile: ProfileData | null,
  provider: AIProvider = getAIProvider()
): Promise<PlanData> {
  const profileLine = profile
    ? `Perfil (para preencher lacunas com coerência): objetivo=${profile.goal}, nível=${profile.experienceLevel}, ${profile.daysPerWeek}x/sem, restrições=[${profile.dietaryRestrictions.join(", ") || "nenhuma"}], lesões=[${profile.injuriesConditions.join(", ") || "nenhuma"}].`
    : "";

  const system = `Você é o assistente do FitSocial. O usuário JÁ TEM um plano (feito por um profissional) e quer inseri-lo no app. Sua tarefa é converter o texto do plano dele para o formato JSON estruturado do app.

REGRAS IMPORTANTES:
- Use FIELMENTE o que o usuário forneceu. NÃO invente exercícios, cargas ou refeições que não estão no texto.
- Se ele forneceu SÓ treino ou SÓ dieta, crie a parte que falta de forma simples e coerente com o perfil, e deixe CLARO no "summary" que essa parte foi sugerida pelo app (não pelo profissional).
- No "summary", diga que este é o plano importado do usuário.
- "disclaimer" deve ser exatamente: "${SAFETY_DISCLAIMER}"
${profileLine}

Responda SOMENTE com um JSON válido neste formato (sem texto fora do JSON):
${PLAN_JSON_FORMAT}`;

  const raw = await provider.generate({
    system,
    messages: [{ role: "user", content: `TEXTO DO PLANO DO USUÁRIO:\n\n${text}` }],
    jsonMode: true,
    temperature: 0.2,
  });

  return parseJson(raw, planDataSchema);
}
