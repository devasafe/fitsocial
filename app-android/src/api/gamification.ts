import { apiFetch } from "./client";

export interface Badge {
  id: string;
  title: string;
  emoji: string;
  description: string;
  earned: boolean;
}

export interface LeaderRow {
  userId: string;
  name: string;
  week: number;
  isMe: boolean;
}

export function getBadges(token: string, userId: string) {
  return apiFetch<{ badges: Badge[] }>(`/gamification/users/${userId}`, { token });
}

export function getLeaderboard(token: string) {
  return apiFetch<{ leaderboard: LeaderRow[] }>("/gamification/leaderboard", { token });
}
