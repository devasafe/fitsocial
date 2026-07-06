/**
 * Normaliza o nome de um exercício para servir de chave de cache:
 * minúsculas, sem acentos, espaços colapsados. Preserva qualificadores
 * ("com barra", "na máquina") porque eles mudam o exercício.
 */
export function normalizeExerciseName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove diacríticos
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
