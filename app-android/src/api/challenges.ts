import { apiFetch } from "./client";

export type ScoreMode = "checkins" | "minutes" | "distance";

export interface Challenge {
  id: string;
  name: string;
  description: string;
  startAt: string;
  endAt: string;
  joinCode: string;
  scoreMode: ScoreMode;
  sportIds: string[];
  visibility: "public" | "code";
  creator: string;
  memberCount?: number;
  isMember?: boolean;
}

export interface LeaderRow {
  userId: string;
  name: string;
  username: string | null;
  avatarUrl: string;
  score: number;
  isMe: boolean;
  position: number;
}

export interface CreateChallengeInput {
  name: string;
  description?: string;
  startAt: string;
  endAt: string;
  scoreMode: ScoreMode;
  sportIds: string[];
  visibility: "public" | "code";
}

export async function listMyChallenges(token: string): Promise<Challenge[]> {
  return (await apiFetch<{ data: Challenge[] }>("/challenges", { token })).data;
}
export async function discoverChallenges(token: string): Promise<Challenge[]> {
  return (await apiFetch<{ data: Challenge[] }>("/challenges/discover", { token })).data;
}
export async function getChallenge(token: string, id: string): Promise<Challenge> {
  return (await apiFetch<{ data: Challenge }>(`/challenges/${id}`, { token })).data;
}
export async function createChallenge(token: string, input: CreateChallengeInput): Promise<Challenge> {
  return (await apiFetch<{ data: Challenge }>("/challenges", { method: "POST", body: input, token })).data;
}
export async function joinChallenge(token: string, code: string): Promise<Challenge> {
  return (await apiFetch<{ data: Challenge }>("/challenges/join", { method: "POST", body: { code }, token })).data;
}
export async function challengeLeaderboard(token: string, id: string): Promise<LeaderRow[]> {
  return (await apiFetch<{ data: LeaderRow[] }>(`/challenges/${id}/leaderboard`, { token })).data;
}

export interface ChallengePost {
  id: string;
  text: string;
  imageUrl: string;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  createdAt: string;
  author: { id: string; name: string; username: string | null; avatarUrl: string };
}

export interface ChallengeComment {
  id: string;
  text: string;
  createdAt: string;
  author: { id: string; name: string; avatarUrl?: string };
}

export async function listChallengePosts(token: string, id: string): Promise<ChallengePost[]> {
  return (await apiFetch<{ data: ChallengePost[] }>(`/challenges/${id}/posts`, { token })).data;
}
export async function createChallengePost(token: string, id: string, text: string): Promise<ChallengePost> {
  return (await apiFetch<{ data: ChallengePost }>(`/challenges/${id}/posts`, { method: "POST", body: { text }, token })).data;
}
export async function likeChallengePost(
  token: string,
  id: string,
  postId: string,
  liked: boolean
): Promise<{ liked: boolean; likeCount: number }> {
  return apiFetch(`/challenges/${id}/posts/${postId}/like`, { method: liked ? "POST" : "DELETE", token });
}

export async function listChallengeComments(token: string, id: string, postId: string): Promise<ChallengeComment[]> {
  return (await apiFetch<{ data: ChallengeComment[] }>(`/challenges/${id}/posts/${postId}/comments`, { token })).data;
}
export async function createChallengeComment(token: string, id: string, postId: string, text: string): Promise<ChallengeComment> {
  return (await apiFetch<{ data: ChallengeComment }>(`/challenges/${id}/posts/${postId}/comments`, { method: "POST", body: { text }, token })).data;
}

export function scoreLabel(mode: ScoreMode, value: number): string {
  if (mode === "distance") return `${value.toFixed(1)} km`;
  if (mode === "minutes") return `${value} min`;
  return `${value} treino${value === 1 ? "" : "s"}`;
}
export function scoreModeName(mode: ScoreMode): string {
  if (mode === "distance") return "Distância (km)";
  if (mode === "minutes") return "Minutos treinados";
  return "Treinos registrados";
}
