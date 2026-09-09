import { apiFetch } from "./client";
import type { NewPR, Activity } from "./activities";

export interface CheckInEntry {
  exerciseName: string;
  weightKg?: number;
  reps?: number;
  durationMin?: number;
  distanceKm?: number;
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
  }
) {
  return apiFetch<{ log: unknown; post: { id: string } | null; newPRs: NewPR[]; activity: Activity }>(
    "/checkins",
    { method: "POST", token, body: data }
  );
}

export interface LastEntry {
  weightKg: number;
  reps: number;
  durationMin: number;
  distanceKm: number;
}
// Última carga/reps por exercício (para pré-preencher o próximo treino).
export async function lastEntries(token: string, names: string[]): Promise<Record<string, LastEntry>> {
  const res = await apiFetch<{ entries: Record<string, LastEntry> }>("/checkins/last-entries", {
    method: "POST",
    token,
    body: { names },
  });
  return res.entries;
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

export interface CardioProgress {
  name: string;
  points: { date: string; durationMin: number; distanceKm: number }[];
}

export function getCardioProgress(token: string) {
  return apiFetch<{ exercises: CardioProgress[] }>("/checkins/cardio-progress", { token });
}
