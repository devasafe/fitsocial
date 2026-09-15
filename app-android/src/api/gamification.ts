import { apiFetch } from "./client";

export interface Badge {
  id: string;
  title: string;
  /** Legado: o que o APK antigo desenha. Aqui só sobrevive como reserva. */
  emoji: string;
  /** Nome no set de ícones. Ausente quando o servidor ainda é o antigo, e
   *  validado na borda: é string vinda da rede, não promessa de tipo. */
  icon?: string;
  description: string;
  earned: boolean;
}

export interface LeaderRow {
  userId: string;
  name: string;
  avatarUrl?: string;
  week: number;
  isMe: boolean;
}

export function getBadges(token: string, userId: string) {
  return apiFetch<{ badges: Badge[] }>(`/gamification/users/${userId}`, { token });
}

export function getLeaderboard(token: string) {
  return apiFetch<{ leaderboard: LeaderRow[] }>("/gamification/leaderboard", { token });
}
