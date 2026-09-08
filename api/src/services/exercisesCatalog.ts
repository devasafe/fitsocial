// Catálogo curado de exercícios (musculação + calistenia) para o autocomplete do
// registro de força. Conjunto inicial correto; expandir é só acrescentar itens.
// Referência: docs/ESPORTES.md §10.

export interface ExerciseDef {
  id: string;
  name: string;
  nameEn?: string;
  muscle: string; // grupo muscular primário
  equipment: string;
  unilateral?: boolean;
  category: "musculacao" | "calistenia";
}

export const EXERCISES: ExerciseDef[] = [
  // Peito
  { id: "supino_reto", name: "Supino reto", nameEn: "Bench press", muscle: "Peito", equipment: "Barra", category: "musculacao" },
  { id: "supino_inclinado", name: "Supino inclinado", nameEn: "Incline bench press", muscle: "Peito", equipment: "Barra", category: "musculacao" },
  { id: "supino_halteres", name: "Supino com halteres", nameEn: "Dumbbell bench press", muscle: "Peito", equipment: "Halteres", category: "musculacao" },
  { id: "crucifixo", name: "Crucifixo", nameEn: "Chest fly", muscle: "Peito", equipment: "Halteres", category: "musculacao" },
  { id: "crossover", name: "Crossover", nameEn: "Cable crossover", muscle: "Peito", equipment: "Cabo", category: "musculacao" },
  { id: "flexao", name: "Flexão de braço", nameEn: "Push-up", muscle: "Peito", equipment: "Peso corporal", category: "calistenia" },

  // Costas
  { id: "levantamento_terra", name: "Levantamento terra", nameEn: "Deadlift", muscle: "Costas", equipment: "Barra", category: "musculacao" },
  { id: "remada_curvada", name: "Remada curvada", nameEn: "Bent-over row", muscle: "Costas", equipment: "Barra", category: "musculacao" },
  { id: "remada_baixa", name: "Remada baixa", nameEn: "Seated cable row", muscle: "Costas", equipment: "Cabo", category: "musculacao" },
  { id: "puxada_alta", name: "Puxada alta", nameEn: "Lat pulldown", muscle: "Costas", equipment: "Cabo", category: "musculacao" },
  { id: "remada_unilateral", name: "Remada unilateral", nameEn: "One-arm dumbbell row", muscle: "Costas", equipment: "Halteres", unilateral: true, category: "musculacao" },
  { id: "barra_fixa", name: "Barra fixa", nameEn: "Pull-up", muscle: "Costas", equipment: "Peso corporal", category: "calistenia" },
  { id: "pulldown_corda", name: "Pullover na polia", nameEn: "Cable pullover", muscle: "Costas", equipment: "Cabo", category: "musculacao" },

  // Pernas
  { id: "agachamento_livre", name: "Agachamento livre", nameEn: "Back squat", muscle: "Quadríceps", equipment: "Barra", category: "musculacao" },
  { id: "agachamento_frontal", name: "Agachamento frontal", nameEn: "Front squat", muscle: "Quadríceps", equipment: "Barra", category: "musculacao" },
  { id: "leg_press", name: "Leg press", nameEn: "Leg press", muscle: "Quadríceps", equipment: "Máquina", category: "musculacao" },
  { id: "cadeira_extensora", name: "Cadeira extensora", nameEn: "Leg extension", muscle: "Quadríceps", equipment: "Máquina", category: "musculacao" },
  { id: "afundo", name: "Afundo", nameEn: "Lunge", muscle: "Quadríceps", equipment: "Halteres", unilateral: true, category: "musculacao" },
  { id: "stiff", name: "Stiff", nameEn: "Stiff-leg deadlift", muscle: "Posterior de coxa", equipment: "Barra", category: "musculacao" },
  { id: "mesa_flexora", name: "Mesa flexora", nameEn: "Lying leg curl", muscle: "Posterior de coxa", equipment: "Máquina", category: "musculacao" },
  { id: "cadeira_flexora", name: "Cadeira flexora", nameEn: "Seated leg curl", muscle: "Posterior de coxa", equipment: "Máquina", category: "musculacao" },
  { id: "elevacao_pelvica", name: "Elevação pélvica", nameEn: "Hip thrust", muscle: "Glúteo", equipment: "Barra", category: "musculacao" },
  { id: "cadeira_abdutora", name: "Cadeira abdutora", nameEn: "Hip abduction", muscle: "Glúteo", equipment: "Máquina", category: "musculacao" },
  { id: "panturrilha_pe", name: "Panturrilha em pé", nameEn: "Standing calf raise", muscle: "Panturrilha", equipment: "Máquina", category: "musculacao" },
  { id: "agachamento_bulgaro", name: "Agachamento búlgaro", nameEn: "Bulgarian split squat", muscle: "Quadríceps", equipment: "Halteres", unilateral: true, category: "musculacao" },
  { id: "pistol_squat", name: "Pistol squat", nameEn: "Pistol squat", muscle: "Quadríceps", equipment: "Peso corporal", unilateral: true, category: "calistenia" },

  // Ombros
  { id: "desenvolvimento_militar", name: "Desenvolvimento militar", nameEn: "Overhead press", muscle: "Ombro", equipment: "Barra", category: "musculacao" },
  { id: "desenvolvimento_halteres", name: "Desenvolvimento com halteres", nameEn: "Dumbbell shoulder press", muscle: "Ombro", equipment: "Halteres", category: "musculacao" },
  { id: "elevacao_lateral", name: "Elevação lateral", nameEn: "Lateral raise", muscle: "Ombro", equipment: "Halteres", category: "musculacao" },
  { id: "elevacao_frontal", name: "Elevação frontal", nameEn: "Front raise", muscle: "Ombro", equipment: "Halteres", category: "musculacao" },
  { id: "crucifixo_inverso", name: "Crucifixo inverso", nameEn: "Reverse fly", muscle: "Ombro", equipment: "Halteres", category: "musculacao" },
  { id: "encolhimento", name: "Encolhimento", nameEn: "Shrug", muscle: "Trapézio", equipment: "Halteres", category: "musculacao" },

  // Bíceps
  { id: "rosca_direta", name: "Rosca direta", nameEn: "Barbell curl", muscle: "Bíceps", equipment: "Barra", category: "musculacao" },
  { id: "rosca_alternada", name: "Rosca alternada", nameEn: "Alternating curl", muscle: "Bíceps", equipment: "Halteres", unilateral: true, category: "musculacao" },
  { id: "rosca_martelo", name: "Rosca martelo", nameEn: "Hammer curl", muscle: "Bíceps", equipment: "Halteres", category: "musculacao" },
  { id: "rosca_scott", name: "Rosca scott", nameEn: "Preacher curl", muscle: "Bíceps", equipment: "Barra", category: "musculacao" },

  // Tríceps
  { id: "triceps_testa", name: "Tríceps testa", nameEn: "Skull crusher", muscle: "Tríceps", equipment: "Barra", category: "musculacao" },
  { id: "triceps_corda", name: "Tríceps corda", nameEn: "Triceps pushdown", muscle: "Tríceps", equipment: "Cabo", category: "musculacao" },
  { id: "triceps_frances", name: "Tríceps francês", nameEn: "Overhead triceps extension", muscle: "Tríceps", equipment: "Halteres", category: "musculacao" },
  { id: "mergulho", name: "Mergulho (paralelas)", nameEn: "Dips", muscle: "Tríceps", equipment: "Peso corporal", category: "calistenia" },

  // Core
  { id: "prancha", name: "Prancha", nameEn: "Plank", muscle: "Abdômen", equipment: "Peso corporal", category: "calistenia" },
  { id: "abdominal_supra", name: "Abdominal", nameEn: "Crunch", muscle: "Abdômen", equipment: "Peso corporal", category: "calistenia" },
  { id: "elevacao_pernas", name: "Elevação de pernas", nameEn: "Leg raise", muscle: "Abdômen", equipment: "Peso corporal", category: "calistenia" },
  { id: "prancha_lateral", name: "Prancha lateral", nameEn: "Side plank", muscle: "Abdômen", equipment: "Peso corporal", unilateral: true, category: "calistenia" },

  // Levantamentos olímpicos / força
  { id: "clean", name: "Clean (levantamento)", nameEn: "Power clean", muscle: "Corpo todo", equipment: "Barra", category: "musculacao" },
  { id: "snatch", name: "Snatch (arranco)", nameEn: "Snatch", muscle: "Corpo todo", equipment: "Barra", category: "musculacao" },
  { id: "clean_and_jerk", name: "Clean & jerk", nameEn: "Clean and jerk", muscle: "Corpo todo", equipment: "Barra", category: "musculacao" },
  { id: "thruster", name: "Thruster", nameEn: "Thruster", muscle: "Corpo todo", equipment: "Barra", category: "musculacao" },
  { id: "overhead_squat", name: "Agachamento overhead", nameEn: "Overhead squat", muscle: "Corpo todo", equipment: "Barra", category: "musculacao" },

  // Calistenia avançada
  { id: "muscle_up", name: "Muscle-up", nameEn: "Muscle-up", muscle: "Costas", equipment: "Peso corporal", category: "calistenia" },
  { id: "hspu", name: "Flexão parada de mão", nameEn: "Handstand push-up", muscle: "Ombro", equipment: "Peso corporal", category: "calistenia" },
  { id: "australian_pullup", name: "Remada australiana", nameEn: "Australian pull-up", muscle: "Costas", equipment: "Peso corporal", category: "calistenia" },
  { id: "front_lever", name: "Front lever", nameEn: "Front lever", muscle: "Costas", equipment: "Peso corporal", category: "calistenia" },
  { id: "l_sit", name: "L-sit", nameEn: "L-sit", muscle: "Abdômen", equipment: "Peso corporal", category: "calistenia" },
];

/** Remove acentos e caixa para busca tolerante. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function searchExercises(q: string, limit = 20): ExerciseDef[] {
  const n = normalize(q);
  if (!n) return EXERCISES.slice(0, limit);
  return EXERCISES.filter(
    (e) => normalize(e.name).includes(n) || (e.nameEn ? normalize(e.nameEn).includes(n) : false)
  ).slice(0, limit);
}
