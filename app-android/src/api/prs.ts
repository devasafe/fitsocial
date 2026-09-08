import { apiFetch } from "./client";

export interface PersonalRecord {
  id: string;
  sportId: string;
  exerciseName: string;
  type: "carga_max" | "rm_estimado" | "carga_faixa";
  repRange: string | null;
  value: number;
  unit: string;
  achievedAt: string;
  previousValue: number | null;
  previousAchievedAt: string | null;
}

export async function listPRs(token: string): Promise<PersonalRecord[]> {
  const res = await apiFetch<{ data: PersonalRecord[] }>("/prs", { token });
  return res.data;
}

/** Rótulo de exibição de um tipo de recorde. */
export function prTypeLabel(type: string, repRange: string | null): string {
  if (type === "carga_max") return "Carga máxima";
  if (type === "rm_estimado") return "1RM estimado";
  if (type === "carga_faixa") return `Carga · ${repRange} reps`;
  return type;
}
