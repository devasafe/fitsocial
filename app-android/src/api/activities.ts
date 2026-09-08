import { apiFetch } from "./client";

export interface StrengthSetInput {
  type?: "aquecimento" | "valida" | "drop" | "falha" | "rest_pause" | "backoff";
  weightKg?: number;
  reps?: number | null;
  holdSec?: number | null;
}
export interface StrengthExerciseInput {
  name: string;
  sets: StrengthSetInput[];
}
export interface CreateActivityInput {
  sportId: string;
  kind: "strength";
  title?: string;
  durationSec?: number;
  visibility?: "private" | "followers" | "public";
  notes?: string;
  payload: { variant?: string; exercises: StrengthExerciseInput[] };
  shareToFeed?: boolean;
  caption?: string;
}

export interface Activity {
  id: string;
  sportId: string;
  kind: string;
  title: string;
  startedAt: string;
  durationSec: number;
  visibility: "private" | "followers" | "public";
  notes: string;
  metrics: { volumeTotalKg?: number; seriesValidas?: number };
}

export async function createActivity(
  token: string,
  input: CreateActivityInput
): Promise<{ data: Activity; meta: { sharedPostId: string | null } }> {
  return apiFetch("/activities", { method: "POST", body: input, token });
}

export async function listActivities(
  token: string,
  cursor?: string
): Promise<{ data: Activity[]; meta: { nextCursor: string | null } }> {
  const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiFetch(`/activities${q}`, { token });
}
