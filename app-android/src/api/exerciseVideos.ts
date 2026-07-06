import { apiFetch } from "./client";

export interface VideoRef {
  youtubeId: string;
  thumbnailUrl: string;
  title: string;
}

/** Resolve os vídeos de execução de uma sessão inteira num único request. */
export async function resolveExerciseVideos(
  names: string[],
  token: string | null
): Promise<Record<string, VideoRef | null>> {
  if (names.length === 0) return {};
  const { videos } = await apiFetch<{ videos: Record<string, VideoRef | null> }>(
    "/exercise-videos/resolve",
    { method: "POST", body: { names }, token }
  );
  return videos;
}
