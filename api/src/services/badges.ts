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
  emoji: string;
  description: string;
  earned: boolean;
}

interface BadgeDef {
  id: string;
  title: string;
  emoji: string;
  description: string;
  test: (s: BadgeInput) => boolean;
}

const DEFS: BadgeDef[] = [
  { id: "primeiro_treino", title: "Primeiro treino", emoji: "🎯", description: "Registrou o primeiro treino", test: (s) => s.totalCheckIns >= 1 },
  { id: "dedicado", title: "Dedicado", emoji: "💪", description: "10 treinos registrados", test: (s) => s.totalCheckIns >= 10 },
  { id: "imparavel", title: "Imparável", emoji: "🏋️", description: "50 treinos registrados", test: (s) => s.totalCheckIns >= 50 },
  { id: "streak_7", title: "Uma semana em chamas", emoji: "🔥", description: "7 dias seguidos treinando", test: (s) => s.streak >= 7 },
  { id: "streak_30", title: "Disciplina de ferro", emoji: "⚡", description: "30 dias seguidos treinando", test: (s) => s.streak >= 30 },
  { id: "primeiro_post", title: "Estreia no feed", emoji: "📸", description: "Fez o primeiro post", test: (s) => s.posts >= 1 },
  { id: "influente", title: "Influente", emoji: "🌟", description: "5 seguidores", test: (s) => s.followers >= 5 },
];

/** Retorna todas as badges com o status (conquistada ou não) do usuário. */
export function computeBadges(input: BadgeInput): Badge[] {
  return DEFS.map((d) => ({
    id: d.id,
    title: d.title,
    emoji: d.emoji,
    description: d.description,
    earned: d.test(input),
  }));
}
