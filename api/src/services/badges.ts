/**
 * Catálogo de conquistas (badges). São computadas sob demanda a partir das
 * estatísticas do usuário — não exigem rastrear eventos nem tabela extra.
 */
export interface BadgeInput {
  totalCheckIns: number;
  streak: number;
  posts: number;
  followers: number;
}

export interface Badge {
  id: string;
  title: string;
  /**
   * O emoji, mantido de propósito.
   *
   * O app novo desenha `icon`; o APK instalado — que não se atualiza sozinho —
   * só conhece `emoji`, e tirá-lo daqui deixaria a grade de conquistas dele
   * vazia. Campo aditivo agora, remoção quando o APK antigo não importar mais.
   */
  emoji: string;
  /** Nome no set de ícones do app. */
  icon: string;
  description: string;
  earned: boolean;
}

interface BadgeDef {
  id: string;
  title: string;
  emoji: string;
  icon: string;
  description: string;
  test: (s: BadgeInput) => boolean;
}

const DEFS: BadgeDef[] = [
  { id: "primeiro_treino", title: "Primeiro treino", emoji: "🎯", icon: "alvo", description: "Registrou o primeiro treino", test: (s) => s.totalCheckIns >= 1 },
  { id: "dedicado", title: "Dedicado", emoji: "💪", icon: "haltere", description: "10 treinos registrados", test: (s) => s.totalCheckIns >= 10 },
  { id: "imparavel", title: "Imparável", emoji: "🏋️", icon: "trofeu", description: "50 treinos registrados", test: (s) => s.totalCheckIns >= 50 },
  { id: "streak_7", title: "Uma semana em chamas", emoji: "🔥", icon: "chama", description: "7 dias seguidos treinando", test: (s) => s.streak >= 7 },
  { id: "streak_30", title: "Disciplina de ferro", emoji: "⚡", icon: "raio", description: "30 dias seguidos treinando", test: (s) => s.streak >= 30 },
  { id: "primeiro_post", title: "Estreia no feed", emoji: "📸", icon: "camera", description: "Fez o primeiro post", test: (s) => s.posts >= 1 },
  { id: "influente", title: "Influente", emoji: "🌟", icon: "estrela", description: "5 seguidores", test: (s) => s.followers >= 5 },
];

/** Retorna todas as badges com o status (conquistada ou não) do usuário. */
export function computeBadges(input: BadgeInput): Badge[] {
  return DEFS.map((d) => ({
    id: d.id,
    title: d.title,
    emoji: d.emoji,
    icon: d.icon,
    description: d.description,
    earned: d.test(input),
  }));
}
