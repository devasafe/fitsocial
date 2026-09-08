// WODs benchmark famosos, com prescrição e tipo de score. Fonte das prescrições:
// docs/ESPORTES.md §6.5. Conjunto inicial curado; expandir é acrescentar itens.
// Ao adicionar novos, confira a prescrição em fonte oficial (§6.5).

export type WodScoreType =
  | "for_time"
  | "amrap"
  | "emom"
  | "rft"
  | "max_load"
  | "for_reps"
  | "tabata"
  | "chipper";

export interface WodBenchmark {
  id: string;
  name: string;
  scoreType: WodScoreType;
  prescription: string;
}

export const WOD_BENCHMARKS: WodBenchmark[] = [
  { id: "fran", name: "Fran", scoreType: "for_time", prescription: "21-15-9 thruster (43/30 kg) + pull-up" },
  { id: "grace", name: "Grace", scoreType: "for_time", prescription: "30 clean & jerk (61/43 kg)" },
  { id: "isabel", name: "Isabel", scoreType: "for_time", prescription: "30 snatch (61/43 kg)" },
  { id: "helen", name: "Helen", scoreType: "rft", prescription: "3 rounds: 400 m corrida + 21 kettlebell swing (24/16 kg) + 12 pull-up" },
  { id: "cindy", name: "Cindy", scoreType: "amrap", prescription: "AMRAP 20 min: 5 pull-up + 10 push-up + 15 air squat" },
  { id: "murph", name: "Murph", scoreType: "for_time", prescription: "1,6 km corrida + 100 pull-up + 200 push-up + 300 air squat + 1,6 km corrida (colete 9/6 kg)" },
  { id: "diane", name: "Diane", scoreType: "for_time", prescription: "21-15-9 deadlift (102/70 kg) + handstand push-up" },
  { id: "karen", name: "Karen", scoreType: "for_time", prescription: "150 wall ball (9/6 kg)" },
  { id: "annie", name: "Annie", scoreType: "for_time", prescription: "50-40-30-20-10 double under + sit-up" },
  { id: "jackie", name: "Jackie", scoreType: "for_time", prescription: "1000 m remo + 50 thruster (barra vazia) + 30 pull-up" },
  { id: "angie", name: "Angie", scoreType: "for_time", prescription: "100 pull-up + 100 push-up + 100 sit-up + 100 air squat" },
  { id: "barbara", name: "Barbara", scoreType: "rft", prescription: "5 rounds: 20 pull-up + 30 push-up + 40 sit-up + 50 air squat, 3 min de descanso" },
  { id: "nancy", name: "Nancy", scoreType: "rft", prescription: "5 rounds: 400 m corrida + 15 overhead squat (43/30 kg)" },
];

function normalize(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

export function searchWods(q: string, limit = 20): WodBenchmark[] {
  const n = normalize(q);
  if (!n) return WOD_BENCHMARKS.slice(0, limit);
  return WOD_BENCHMARKS.filter((w) => normalize(w.name).includes(n)).slice(0, limit);
}
