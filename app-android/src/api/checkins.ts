import { apiFetch } from "./client";

export interface CheckInEntry {
  exerciseName: string;
  weightKg?: number;
  reps?: number;
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

export interface WorkoutLogItem {
  id: string;
  sessionDay: string;
  date: string;
  entries: { exerciseName: string; weightKg?: number; reps?: number }[];
  notes: string;
}

export function getHistory(token: string) {
  return apiFetch<{ logs: WorkoutLogItem[] }>("/checkins", { token });
}

export interface ExerciseProgress {
  name: string;
  points: { date: string; weightKg: number }[];
}

export function getProgress(token: string) {
  return apiFetch<{ exercises: ExerciseProgress[] }>("/checkins/progress", { token });
}
