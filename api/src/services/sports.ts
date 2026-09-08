// Catálogo estático dos esportes suportados e o formato (kind) de payload de cada
// um. IDs são strings estáveis (ver docs/ARQUITETURA.md §3). Fonte: docs/ESPORTES.md §2.
// Fase 2 = 21 esportes / 5 formatos. climb e match entram na Fase 2.1.

export const ACTIVITY_KINDS = ["strength", "endurance", "wod", "class", "generic"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export type GpsSupport = "sim" | "nao" | "opcional";

export interface SportDef {
  id: string;
  label: string;
  kind: ActivityKind;
  color: string;
  gps: GpsSupport;
}

export const SPORTS: readonly SportDef[] = [
  { id: "musculacao", label: "Musculação", kind: "strength", color: "#C8FA4B", gps: "nao" },
  { id: "calistenia", label: "Calistenia", kind: "strength", color: "#B4E63F", gps: "nao" },
  { id: "powerlifting", label: "Powerlifting", kind: "strength", color: "#8FBF42", gps: "nao" },
  { id: "lpo", label: "Levantamento olímpico", kind: "strength", color: "#A8D42E", gps: "nao" },
  { id: "corrida", label: "Corrida de rua", kind: "endurance", color: "#FF8A4C", gps: "sim" },
  { id: "trail", label: "Corrida em trilha", kind: "endurance", color: "#E06A2C", gps: "sim" },
  { id: "esteira", label: "Esteira", kind: "endurance", color: "#FFA06B", gps: "nao" },
  { id: "caminhada", label: "Caminhada", kind: "endurance", color: "#96A39A", gps: "sim" },
  { id: "ciclismo", label: "Ciclismo", kind: "endurance", color: "#4C9AFF", gps: "sim" },
  { id: "natacao", label: "Natação", kind: "endurance", color: "#2FD4D4", gps: "opcional" },
  { id: "remo", label: "Remo / ergômetro", kind: "endurance", color: "#3AA8C4", gps: "nao" },
  { id: "crossfit", label: "CrossFit", kind: "wod", color: "#F5C63C", gps: "nao" },
  { id: "funcional", label: "Funcional / HIIT", kind: "wod", color: "#4FD69C", gps: "nao" },
  { id: "jiu_jitsu", label: "Jiu-jitsu", kind: "class", color: "#9B7CF0", gps: "nao" },
  { id: "muay_thai", label: "Muay thai", kind: "class", color: "#F27299", gps: "nao" },
  { id: "boxe", label: "Boxe", kind: "class", color: "#EF5350", gps: "nao" },
  { id: "mma", label: "MMA", kind: "class", color: "#D96FE0", gps: "nao" },
  { id: "judo", label: "Judô", kind: "class", color: "#7C9BF0", gps: "nao" },
  { id: "yoga", label: "Yoga", kind: "class", color: "#DCC4A0", gps: "nao" },
  { id: "pilates", label: "Pilates", kind: "class", color: "#C9B08A", gps: "nao" },
  { id: "outro", label: "Outro", kind: "generic", color: "#7A8079", gps: "opcional" },
];

const BY_ID = new Map(SPORTS.map((s) => [s.id, s]));

export function getSport(sportId: string): SportDef | undefined {
  return BY_ID.get(sportId);
}

export function isValidSport(sportId: string): boolean {
  return BY_ID.has(sportId);
}
