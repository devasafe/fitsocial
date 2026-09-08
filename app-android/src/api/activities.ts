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

interface CommonInput {
  sportId: string;
  title?: string;
  durationSec?: number;
  visibility?: "private" | "followers" | "public";
  notes?: string;
  shareToFeed?: boolean;
  caption?: string;
}

export type CreateActivityInput =
  | (CommonInput & { kind: "strength"; payload: { variant?: string; exercises: StrengthExerciseInput[] } })
  | (CommonInput & {
      kind: "endurance";
      payload: { subType?: string; distanceM: number; elevationGainM?: number | null };
    })
  | (CommonInput & {
      kind: "class";
      payload: { modality: string; sessionType?: string; gi?: boolean | null; rounds?: number | null };
    })
  | (CommonInput & {
      kind: "generic";
      payload: {
        activityName: string;
        description?: string | null;
        customMetrics?: { label: string; value: string; unit?: string | null }[];
      };
    });

export interface Activity {
  id: string;
  sportId: string;
  kind: string;
  title: string;
  startedAt: string;
  durationSec: number;
  visibility: "private" | "followers" | "public";
  notes: string;
  metrics: Record<string, number>;
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
