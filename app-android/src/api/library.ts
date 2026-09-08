import { apiFetch } from "./client";

export interface ExerciseDef {
  id: string;
  name: string;
  nameEn?: string;
  muscle: string;
  equipment: string;
  unilateral?: boolean;
  category: "musculacao" | "calistenia";
}

export interface WodBenchmark {
  id: string;
  name: string;
  scoreType: string;
  prescription: string;
}

export async function searchExercises(token: string, q: string): Promise<ExerciseDef[]> {
  const res = await apiFetch<{ data: ExerciseDef[] }>(
    `/library/exercises?q=${encodeURIComponent(q)}`,
    { token }
  );
  return res.data;
}

export async function searchWods(token: string, q: string): Promise<WodBenchmark[]> {
  const res = await apiFetch<{ data: WodBenchmark[] }>(`/library/wods?q=${encodeURIComponent(q)}`, {
    token,
  });
  return res.data;
}
