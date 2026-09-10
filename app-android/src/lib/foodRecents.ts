// Alimentos recentes guardados localmente (não há endpoint de "recentes" hoje).
// Alimenta o quick-add de nutrição — re-registrar o que você come sempre em 1 toque.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchRecentFoods } from "../api/nutrition";

export interface RecentFood {
  name: string;
  kcal: number;
  proteinG: number;
  /** Opcionais: os recentes gravados antes disto so tinham kcal e proteina. */
  carbsG?: number;
  fatG?: number;
}

// Recentes do servidor (autoritativo, cruza dispositivos) com fallback local.
export async function loadRecents(token: string): Promise<RecentFood[]> {
  try {
    const server = await fetchRecentFoods(token);
    if (server.length) return server;
  } catch {
    /* offline / erro — cai no cache local */
  }
  return getRecentFoods();
}

const KEY = "fitsocial.foodRecents";

export async function getRecentFoods(): Promise<RecentFood[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RecentFood[]) : [];
  } catch {
    return [];
  }
}

export async function pushRecentFood(f: RecentFood): Promise<void> {
  try {
    const cur = await getRecentFoods();
    const next = [f, ...cur.filter((x) => x.name.toLowerCase() !== f.name.toLowerCase())].slice(0, 12);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* best-effort */
  }
}
