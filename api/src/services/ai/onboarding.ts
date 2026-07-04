import { z } from "zod";
import { getAIProvider, parseJson, type AIMessage, type AIProvider } from "./index.js";
import { GOALS, SEXES, LEVELS, profileDataSchema, type ProfileData } from "../../models/Profile.js";

// O que a IA devolve a cada turno da conversa. A ficha intermediária é
// TOLERANTE de propósito (o modelo costuma mandar campos ainda vazios como
// null); a validação estrita acontece só quando complete=true (ver abaixo).
const turnSchema = z.object({
  reply: z.string(), // mensagem a mostrar ao usuário
  complete: z.boolean().optional().default(false), // true quando a ficha está completa
  profile: z.unknown().nullable().optional(), // ficha parcial (validada só no fim)
});

export interface OnboardingTurn {
  reply: string;
  complete: boolean;
  profile: ProfileData | null;
}

const SYSTEM_PROMPT = `Você é o coach do FitSocial, um app de treino e nutrição. Sua tarefa é conduzir uma conversa de cadastro (onboarding) calorosa e natural, em português do Brasil, para conhecer a pessoa e montar a ficha dela.

COMPORTAMENTO:
- Fale como um treinador amigável e acolhedor, não como um formulário. Uma pergunta por vez.
- Adapte o tom: se a pessoa é iniciante/sedentária, seja encorajador e simples; se é avançada, pode usar termos técnicos.
- Descubra e preencha TODOS os campos obrigatórios da ficha antes de concluir.

CAMPOS OBRIGATÓRIOS da ficha (profile):
- goal: um de ${GOALS.join(", ")}
- sex: um de ${SEXES.join(", ")}
- age: idade em anos (número)
- heightCm: altura em cm (número)
- weightKg: peso em kg (número)
- experienceLevel: um de ${LEVELS.join(", ")} (iniciante = nunca/quase nunca treina)
- daysPerWeek: quantos dias por semana pode treinar (1 a 7)
- sessionMinutes: minutos disponíveis por sessão
- dietaryRestrictions: lista de restrições alimentares (ex.: ["lactose"], ou [] se nenhuma)
- injuriesConditions: lista de lesões/condições de saúde relevantes (ex.: ["dor no joelho"], ou [] se nenhuma)
- notes: observações livres relevantes (ou "")

TRIAGEM DE SAÚDE E SEGURANÇA (obrigatório):
- Sempre pergunte sobre lesões e condições de saúde antes de concluir.
- Se a pessoa relatar condição médica séria (cardíaca, gestação, pressão alta, cirurgia recente, transtorno alimentar etc.), registre em injuriesConditions e, no reply, oriente-a a procurar um profissional de saúde. NÃO se recuse a continuar, mas deixe claro no reply que o plano é um ponto de partida e não substitui acompanhamento profissional.

FORMATO DE SAÍDA — responda SEMPRE apenas com um JSON válido, sem texto fora dele, no formato:
{
  "reply": "sua próxima mensagem para a pessoa",
  "complete": false,
  "profile": { ...campos coletados até agora, use null se ainda não tiver a ficha... }
}
- Enquanto faltar qualquer campo obrigatório: complete=false e "profile" pode ser parcial ou null.
- Quando TODOS os campos obrigatórios estiverem coletados: complete=true, "profile" com TODOS os campos preenchidos, e "reply" com uma mensagem de encerramento animando a pessoa para ver o plano.`;

/** Executa um turno do onboarding: recebe o histórico e devolve reply + ficha + status. */
export async function runOnboardingTurn(
  messages: AIMessage[],
  provider: AIProvider = getAIProvider()
): Promise<OnboardingTurn> {
  const raw = await provider.generate({
    system: SYSTEM_PROMPT,
    messages,
    jsonMode: true,
    temperature: 0.6,
  });

  const turn = parseJson(raw, turnSchema);

  // Só consideramos "completo" se a ficha realmente validar por inteiro.
  if (turn.complete) {
    const full = profileDataSchema.safeParse(turn.profile);
    if (full.success) {
      return { reply: turn.reply, complete: true, profile: full.data };
    }
  }
  return { reply: turn.reply, complete: false, profile: null };
}

/** Mensagem inicial do coach, mostrada antes do usuário digitar. */
export const ONBOARDING_GREETING =
  "Oi! Eu sou seu coach aqui no FitSocial 💪 Vou te fazer algumas perguntas rápidas pra montar seu treino e sua dieta sob medida. Pra começar: qual é seu principal objetivo hoje — perder gordura, ganhar massa, cuidar da saúde ou melhorar performance?";

export type { ProfileData };
