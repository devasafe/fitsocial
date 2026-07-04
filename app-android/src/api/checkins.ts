import { apiFetch } from "./client";

export interface CheckInEntry {
  exerciseName: string;
  weightKg: number;
  reps: number;
}

export interface CheckInStats {
  total: number;
  week: number;
  streak: number;
  lastCheckIn: string | null;
}

export function createCheckIn(
  token: string,
  data: {
    sessionDay: string;
    entries: CheckInEntry[];
    notes?: string;
    shareToFeed?: boolean;
    shareText?: string;
  }
) {
  return apiFetch<{ log: unknown; post: { id: string } | null }>("/checkins", {
    method: "POST",
    token,
    body: data,
  });
}

export function getCheckInStats(token: string) {
  return apiFetch<{ stats: CheckInStats }>("/checkins/stats", { token });
}
