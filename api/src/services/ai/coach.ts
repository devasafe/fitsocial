import { z } from "zod";
import { getAIProvider, parseJson, type AIMessage, type AIProvider } from "./index.js";
import type { ProfileData } from "../../models/Profile.js";
import type { PlanData } from "../../models/Plan.js";
import type { CheckInStats } from "../adherence.js";

// A cada turno o coach devolve a resposta + uma possível ação a executar.
const coachTurnSchema = z.object({
  reply: z.string(),
  action: z.enum(["none", "adjust_plan"]).optional().default("none"),
});

export interface CoachTurn {
  reply: string;
  action: "none" | "adjust_plan";
}

export interface CoachContext {
  profile: ProfileData | null;
  plan: PlanData | null;
  stats: CheckInStats;
  tier: "free" | "premium";
}

function buildContextBlock(ctx: CoachContext): string {
  const parts: string[] = [];
  if (ctx.profile) {
    parts.push(
      `PERFIL: objetivo=${ctx.profile.goal}, nível=${ctx.profile.experienceLevel}, ` +
        `${ctx.profile.daysPerWeek}x/sem de ${ctx.profile.sessionMinutes}min, ` +
        `restrições=[${ctx.profile.dietaryRestrictions.join(", ") || "nenhuma"}], ` +
        `lesões/condições=[${ctx.profile.injuriesConditions.join(", ") || "nenhuma"}]`
    );
  }
  if (ctx.plan) {
    parts.push(
      `PLANO ATUAL: treino "${ctx.plan.workout.split}" (${ctx.plan.workout.daysPerWeek}x/sem), ` +
        `dieta ${ctx.plan.diet.dailyCalories} kcal.`
    );
  }
  parts.push(
    `ADESÃO: streak ${ctx.stats.streak} dia(s), ${ctx.stats.week} treino(s) na semana, ${ctx.stats.total} no total.`
  );
  parts.push(`PLANO DO USUÁRIO NO APP: ${ctx.tier === "premium" ? "Premium" : "Grátis"}.`);
  return parts.join("\n");
}

function buildSystemPrompt(ctx: CoachContext): string {
  return `Você é o coach pessoal do FitSocial: um treinador e nutricionista virtual, empático e motivador, que acompanha a pessoa na jornada fitness. Fale em português do Brasil, de forma calorosa, prática e encorajadora.

CONTEXTO ATUAL DO USUÁRIO:
${buildContextBlock(ctx)}

COMO AGIR:
- Ouça a dificuldade da pessoa (falta de motivação, dores, semana corrida, alimentação) e responda com empatia + orientação prática baseada no contexto acima.
- Seja específico: use o objetivo, o nível, a adesão e o plano da pessoa nas suas respostas.
- Se a pessoa relatar dor/lesão ou condição de saúde preocupante, oriente a procurar um profissional. NADA que você diz substitui médico, nutricionista ou educador físico.
- Mensagens curtas e humanas (2-5 frases). Uma pergunta por vez quando precisar entender melhor.

REAJUSTE DE PLANO (ação):
- Se, pela conversa, ficar claro que o plano precisa mudar (a pessoa está achando difícil demais, fácil demais, sem tempo, evoluiu muito) E a pessoa CONCORDAR em reajustar, defina "action":"adjust_plan".
- Só faça isso se o usuário for Premium. Se for Grátis, NÃO use a ação: explique gentilmente que o reajuste do plano pelo coach é um recurso Premium e convide a assinar.
- Em todos os outros casos use "action":"none".

Responda SEMPRE apenas com um JSON válido:
{ "reply": "sua mensagem para a pessoa", "action": "none" | "adjust_plan" }`;
}

/** Executa um turno da conversa com o coach. */
export async function runCoachTurn(
  history: AIMessage[],
  ctx: CoachContext,
  provider: AIProvider = getAIProvider()
): Promise<CoachTurn> {
  const raw = await provider.generate({
    system: buildSystemPrompt(ctx),
    messages: history,
    jsonMode: true,
    temperature: 0.7,
  });

  // Num chat, a IA nunca deve "quebrar": se não vier JSON válido, usamos o
  // texto como resposta (sem ação). O gating premium é aplicado na rota.
  try {
    const turn = parseJson(raw, coachTurnSchema);
    return { reply: turn.reply, action: turn.action };
  } catch {
    return { reply: extractReplyFallback(raw), action: "none" };
  }
}

/** Recupera uma resposta legível quando a IA não devolve JSON válido. */
function extractReplyFallback(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  // Se for um JSON quase-válido, tenta puxar o campo "reply".
  const match = cleaned.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (match) return match[1].replace(/\\"/g, '"').replace(/\\n/g, "\n");
  return cleaned || "Desculpa, não entendi bem. Pode repetir?";
}

export const COACH_GREETING =
  "E aí! 👋 Sou seu coach aqui no FitSocial. Como você está se sentindo com os treinos e a dieta? Pode desabafar comigo — se tá difícil, se bateu preguiça, se algo doeu, ou se tá voando. Bora ajustar juntos o que precisar. 💪";
