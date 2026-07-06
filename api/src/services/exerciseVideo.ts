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

import { env } from "../config/env.js";

const YT_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";

export type YoutubeHit = { youtubeId: string; title: string } | null;
export type YoutubeSearcher = (query: string) => Promise<YoutubeHit>;

/** Miniatura padrão do YouTube a partir do ID do vídeo. */
export function thumbnailFor(youtubeId: string): string {
  return `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;
}

interface YoutubeSearchResponse {
  items?: { id?: { videoId?: string }; snippet?: { title?: string } }[];
  error?: { message?: string };
}

// Searcher padrão: YouTube Data API v3, vídeos curtos, relevância em PT.
const defaultSearcher: YoutubeSearcher = async (query) => {
  if (!env.youtubeApiKey) return null;
  const params = new URLSearchParams({
    key: env.youtubeApiKey,
    q: query,
    part: "snippet",
    type: "video",
    videoDuration: "short",
    maxResults: "1",
    relevanceLanguage: "pt",
    safeSearch: "strict",
  });

  let res: Response;
  try {
    res = await fetch(`${YT_SEARCH_URL}?${params.toString()}`);
  } catch {
    return null; // falha de rede: não persiste miss, tenta de novo depois
  }
  if (!res.ok) return null; // inclui 403 de quota estourada

  const data = (await res.json().catch(() => ({}))) as YoutubeSearchResponse;
  const item = data.items?.[0];
  const videoId = item?.id?.videoId;
  if (!videoId) return null;
  return { youtubeId: videoId, title: item?.snippet?.title ?? "" };
};

let searcher: YoutubeSearcher | null = null;

/** Injeta um searcher (mock nos testes). Passe null para voltar ao padrão. */
export function setYoutubeSearcher(fn: YoutubeSearcher | null): void {
  searcher = fn;
}

/** Retorna o searcher injetado ou o padrão (REST). */
export function getYoutubeSearcher(): YoutubeSearcher {
  return searcher ?? defaultSearcher;
}

import { ExerciseVideo } from "../models/ExerciseVideo.js";

export type ResolvedVideo = { youtubeId: string; thumbnailUrl: string; title: string } | null;

function toResolved(doc: { youtubeId: string | null; thumbnailUrl?: string; title?: string }): ResolvedVideo {
  if (!doc.youtubeId) return null;
  return {
    youtubeId: doc.youtubeId,
    thumbnailUrl: doc.thumbnailUrl || thumbnailFor(doc.youtubeId),
    title: doc.title ?? "",
  };
}

/**
 * Resolve um nome de exercício para um vídeo do YouTube, cache-first.
 * - Cache hit (inclusive "miss" persistido): retorna sem tocar na rede.
 * - Miss: busca no YouTube; se achar, persiste vídeo; se não, persiste "miss" (youtubeId: null).
 * - Falha de rede/quota (searcher retorna null): NÃO persiste miss aqui — deixa re-tentar depois.
 *   Diferenciamos "sem API key" olhando env: sem key nunca persiste nada.
 */
export async function resolveExerciseVideo(name: string): Promise<ResolvedVideo> {
  const normalizedName = normalizeExerciseName(name);
  if (!normalizedName) return null;

  const cached = await ExerciseVideo.findOne({ normalizedName });
  if (cached) return toResolved(cached);

  // Sem chave configurada: não persiste nada (feature degradada).
  if (!env.youtubeApiKey) return null;

  const hit = await getYoutubeSearcher()(`${name} execução correta`);

  // Persiste o resultado (vídeo achado OU "miss" definitivo). Upsert protege de corrida.
  const update = hit
    ? { youtubeId: hit.youtubeId, thumbnailUrl: thumbnailFor(hit.youtubeId), title: hit.title, source: "youtube" as const }
    : { youtubeId: null, thumbnailUrl: "", title: "", source: "youtube" as const };

  await ExerciseVideo.updateOne(
    { normalizedName },
    { $setOnInsert: { normalizedName, displayName: name, pinned: false }, $set: update },
    { upsert: true }
  );

  return hit ? toResolved({ youtubeId: hit.youtubeId, thumbnailUrl: thumbnailFor(hit.youtubeId), title: hit.title }) : null;
}
