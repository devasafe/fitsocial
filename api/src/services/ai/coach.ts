import { z } from "zod";
import { getAIProvider, parseJson, type AIMessage, type AIProvider } from "./index.js";
import type { ProfileData } from "../../models/Profile.js";
import type { PlanParts } from "../../models/Plan.js";
import type { CheckInStats } from "../adherence.js";
import { env } from "../../config/env.js";

// A cada turno o coach devolve a resposta + uma possível ação a executar.
const coachTurnSchema = z.object({
  reply: z.string(),
  action: z.enum(["none", "adjust_plan", "adjust_diet"]).optional().default("none"),
});

export interface CoachTurn {
  reply: string;
  /** `adjust_plan` mexe no treino; `adjust_diet`, só na dieta. Separados porque
   *  as duas metades passaram a existir uma sem a outra: reajustar "o plano" de
   *  quem só tem dieta geraria um treino que a pessoa não pediu. */
  action: "none" | "adjust_plan" | "adjust_diet";
}

/** O que a pessoa comeu hoje, contra a meta. */
export interface ConsumoDeHoje {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  refeicoesRegistradas: number;
}

export interface CoachContext {
  profile: ProfileData | null;
  /** `PlanParts`, não `PlanData`: cada metade pode faltar de verdade. */
  plan: PlanParts | null;
  stats: CheckInStats;
  tier: "free" | "premium";
  /** Sem isto, "posso comer isso no jantar?" é pergunta sem resposta. */
  hoje?: ConsumoDeHoje | null;
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
    // Cada metade pode faltar: há quem tenha só dieta (treina pela programação
    // do box) e quem tenha só treino. Falar de uma metade inexistente faria o
    // coach inventar um plano que a pessoa não tem.
    const metades: string[] = [];
    if (ctx.plan.workout) {
      metades.push(
        `treino "${ctx.plan.workout.split}" (${ctx.plan.workout.daysPerWeek}x/sem)`
      );
    }
    if (ctx.plan.diet) metades.push(`dieta ${ctx.plan.diet.dailyCalories} kcal`);
    if (metades.length) parts.push(`PLANO ATUAL: ${metades.join(", ")}.`);
  }

  // A dieta INTEIRA, refeição por refeição.
  //
  // Antes o coach só recebia "dieta 2200 kcal". Com isso, "posso trocar o arroz
  // do almoço por batata doce?" era pergunta feita a alguém que não sabe o que
  // tem no almoço — e a resposta saía genérica ou inventada.
  const dieta = ctx.plan?.diet;
  if (dieta) {
    const m = dieta.macros;
    const linhas = dieta.meals.map(
      (r) =>
        `  - ${r.name}${r.timeHint ? ` (${r.timeHint})` : ""}: ` +
        r.items.map((i) => `${i.food} ${i.quantity}`).join(", ")
    );
    parts.push(
      `DIETA ATUAL: ${dieta.dailyCalories} kcal/dia · ` +
        `${m.proteinG}g proteína, ${m.carbsG}g carboidrato, ${m.fatG}g gordura\n` +
        linhas.join("\n") +
        (dieta.notes ? `\n  Observações: ${dieta.notes}` : "")
    );
  }

  if (ctx.hoje) {
    const alvo = dieta?.dailyCalories;
    const restante = alvo ? alvo - ctx.hoje.kcal : null;
    parts.push(
      `COMEU HOJE: ${ctx.hoje.kcal} kcal em ${ctx.hoje.refeicoesRegistradas} registro(s) ` +
        `(${ctx.hoje.proteinG}g P, ${ctx.hoje.carbsG}g C, ${ctx.hoje.fatG}g G)` +
        (restante !== null ? `. Restam ${restante} kcal para a meta do dia.` : ".")
    );
  }
  if (ctx.plan && !ctx.plan.workout) {
    parts.push("TREINO: a pessoa segue a programação própria/do box, não um plano gerado aqui.");
  }
  parts.push(
    `ADESÃO: streak ${ctx.stats.streak} dia(s), ${ctx.stats.week} treino(s) na semana, ${ctx.stats.total} no total.`
  );
  parts.push(`PLANO DO USUÁRIO NO APP: ${ctx.tier === "premium" ? "Premium" : "Grátis"}.`);
  return parts.join("\n");
}

function buildSystemPrompt(ctx: CoachContext): string {
  return `Você é o coach pessoal do ${env.appName}: um treinador e nutricionista virtual, empático e motivador, que acompanha a pessoa na jornada fitness. Fale em português do Brasil, de forma calorosa, prática e encorajadora.

CONTEXTO ATUAL DO USUÁRIO:
${buildContextBlock(ctx)}

COMO AGIR:
- Ouça a dificuldade da pessoa (falta de motivação, dores, semana corrida, alimentação) e responda com empatia + orientação prática baseada no contexto acima.
- Seja específico: use o objetivo, o nível, a adesão e o plano da pessoa nas suas respostas.
- Se a pessoa relatar dor/lesão ou condição de saúde preocupante, oriente a procurar um profissional. NADA que você diz substitui médico, nutricionista ou educador físico.
- Mensagens curtas e humanas (2-5 frases). Uma pergunta por vez quando precisar entender melhor.

SOBRE A DIETA:
- Você tem a dieta completa acima, refeição por refeição. Use os alimentos e quantidades REAIS dela ao responder — nada de sugerir o que não está lá sem dizer que é uma troca.
- Ao sugerir substituições, respeite as restrições alimentares da ficha e mantenha a refeição perto dos macros originais.
- Se souber o que a pessoa já comeu hoje, use isso: o que sobrou de calorias muda a resposta sobre o que cabe no jantar.
${ctx.plan?.diet ? "" : "- A pessoa NÃO tem dieta montada aqui. Não invente uma: se ela quiser, oriente a gerar em Início."}

REAJUSTE (ações):
- "adjust_plan" — reajusta o TREINO. Use quando ficar claro pela conversa que o treino precisa mudar (difícil demais, fácil demais, sem tempo, evoluiu muito) E a pessoa CONCORDAR.${ctx.plan?.workout ? "" : ' NÃO use: a pessoa não tem treino montado aqui, ela segue a programação própria/do box.'}
- "adjust_diet" — refaz a DIETA. Use quando a conversa mostrar que a dieta não serve (não gosta dos alimentos, não cabe na rotina, mudou de objetivo, restrição nova) E a pessoa CONCORDAR.${ctx.plan?.diet ? "" : ' NÃO use: a pessoa não tem dieta montada aqui.'}
- Uma ação por vez. Reajustar o treino não mexe na dieta, e vice-versa.
- Só use ação se o usuário for Premium. Se for Grátis, NÃO use: explique gentilmente que o reajuste pelo coach é um recurso Premium e convide a assinar.
- Em todos os outros casos use "action":"none".

Responda SEMPRE apenas com um JSON válido:
{ "reply": "sua mensagem para a pessoa", "action": "none" | "adjust_plan" | "adjust_diet" }`;
}

/** Executa um turno da conversa com o coach. */
export async function runCoachTurn(
  history: AIMessage[],
  ctx: CoachContext,
  userId?: string,
  provider: AIProvider = getAIProvider()
): Promise<CoachTurn> {
  const raw = await provider.generate({
    system: buildSystemPrompt(ctx),
    messages: history,
    jsonMode: true,
    temperature: 0.7,
    feature: "coach",
    userId,
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
  `E aí! 👋 Sou seu coach aqui no ${env.appName}. Como você está se sentindo com os treinos e a dieta? Pode desabafar comigo — se tá difícil, se bateu preguiça, se algo doeu, ou se tá voando. Bora ajustar juntos o que precisar. 💪`;
