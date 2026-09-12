import { apiFetch } from "./client";

/**
 * Os grupos musculares que o servidor conhece — espelho de
 * `api/src/services/muscleGroups.ts`.
 *
 * É o vocabulário gravado, então tem que bater letra por letra: um valor fora
 * desta lista é recusado pelo zod na hora de salvar o treino. A REGRA de
 * resolver nome→músculo continua só no servidor; aqui é a lista de opções que
 * a pessoa vê quando o app não reconheceu o exercício.
 */
export const MUSCLE_GROUPS = [
  "Peito",
  "Costas",
  "Quadríceps",
  "Posterior de coxa",
  "Glúteo",
  "Panturrilha",
  "Ombro",
  "Trapézio",
  "Bíceps",
  "Tríceps",
  "Abdômen",
  "Corpo todo",
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export interface ExerciseDef {
  id: string;
  name: string;
  nameEn?: string;
  muscle: MuscleGroup;
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
