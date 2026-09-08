// Rótulo de exibição a partir do sportId (ex.: "jiu_jitsu" -> "Jiu jitsu").
export function sportLabel(sportId: string): string {
  const s = sportId.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
