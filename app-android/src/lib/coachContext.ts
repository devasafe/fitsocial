// Voz do coach a partir do que o app já sabe (sem inventar número).
// Usado na Home e no Resumo do Progresso para o coach parecer presente e contextual.
import type { CheckInStats } from "../api/checkins";

export function coachLine(stats: CheckInStats): string {
  if (stats.streak >= 7) return `${stats.streak} dias seguidos treinando. Isso é raro — segue firme.`;
  if (stats.streak >= 3) return `${stats.streak} dias seguidos. Consistência é o que constrói resultado.`;
  if (stats.week >= 3) return `${stats.week} treinos essa semana. Ritmo forte, continue assim.`;
  if (stats.week >= 1) return `Você já treinou ${stats.week}x essa semana. Bora manter o ritmo.`;
  if (stats.total > 0) return `Faz um tempo desde o último treino. Que tal voltar hoje?`;
  return `Seu primeiro treino começa hoje. Bora?`;
}
