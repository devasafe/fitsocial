import type { PayloadDeCrossfit } from "./crossfit";
import { apiFetch } from "./client";
import type { ActivityMetrics } from "./activities";

export interface SearchUser {
  id: string;
  name: string;
  username: string | null;
  avatarUrl: string;
  isFollowing: boolean;
}

export interface PostAuthor {
  id: string;
  name: string;
  avatarUrl?: string;
  // Presentes no feed Explorar (descoberta); ausentes/false nos outros contextos.
  isMe?: boolean;
  isFollowing?: boolean;
}
export interface PostActivity {
  id: string;
  kind: string;
  sportId: string;
  title: string;
  stats: string[]; // ex.: ["5,2 km", "27:30", "5:18 /km"]
  /**
   * Os movimentos já ESCRITOS pelo servidor: "21-15-9  Thruster  43/30 kg".
   *
   * Vinham como objeto e o card remontava a frase. Eram duas implementações da
   * mesma formatação — esta e a do cartão de compartilhar — e as duas tinham
   * que concordar sobre como se escreve um movimento. Agora é uma só, no
   * servidor, e ela serve o feed e o cartão.
   */
  movements: string[] | null;
}
export interface Post {
  id: string;
  /** Preenchido quando o texto foi alterado — a tela mostra "(editado)". */
  editedAt?: string | null;
  text: string;
  imageUrl: string;
  /** Tamanho da foto. Null nos posts anteriores a isto — aí o app usa o
   *  tamanho que o próprio carregamento informa. */
  imageWidth?: number | null;
  imageHeight?: number | null;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  createdAt: string;
  author: PostAuthor;
  // Resumo da atividade compartilhada (ex.: movimentos do WOD). Null em posts só de texto.
  activity?: PostActivity | null;
}

export interface Comment {
  id: string;
  text: string;
  createdAt: string;
  author: PostAuthor;
}
export interface UserProfile {
  user: { id: string; name: string; username: string | null; avatarUrl: string; bio: string };
  /** `treinos` conta atividades registradas; `posts`, o que foi publicado.
   *  Antes o app exibia `posts` sob o rótulo "Treinos". */
  counts: { treinos: number; posts: number; followers: number; following: number };
  isFollowing: boolean;
  isMe: boolean;
  posts: Post[];
}

/** Um treino no perfil de alguém. Não é um post — é o registro do que a
 *  pessoa fez, com ou sem ter compartilhado no feed. */
export interface TreinoPublico {
  id: string;
  sportId: string;
  kind: string;
  title: string;
  startedAt: string;
  durationSec: number;
  metrics: ActivityMetrics;
  payload: Record<string, unknown>;
  /** CrossFit já em blocos — o servidor normaliza os dois formatos. */
  crossfit?: PayloadDeCrossfit | null;
  /** Os exercícios já escritos pelo servidor: "4×10  Supino reto  80 kg".
   *  O mesmo formatador que serve o feed e o cartão de compartilhar. */
  movimentos?: string[] | null;
  /** Quantos exercícios o treino tem de verdade — `movimentos` vem cortado. */
  movimentosTotal?: number;
  /** true quando esse treino também virou publicação no feed. */
  compartilhado: boolean;
}

// Post: qualquer combinação de texto, foto e treino anexado (ao menos um).
export function createPost(
  token: string,
  input: {
    text?: string;
    imageUrl?: string;
    imageWidth?: number;
    imageHeight?: number;
    activityId?: string;
  }
) {
  return apiFetch<{ post: Post }>("/social/posts", { method: "POST", token, body: input });
}

export type FormatoDoCartao = "story" | "feed";

/**
 * Pede ao servidor o cartao para compartilhar fora do app.
 *
 * O desenho e montado la: assim o mesmo cartao vale para Android e navegador,
 * e mudar o layout depois nao obriga ninguem a atualizar o app.
 */
/** Os desenhos que o servidor sabe montar. `numeros` nao e escolhivel: e o
 *  que sai sozinho quando o post nao tem foto. */
export const LAYOUTS_DO_CARTAO = ["foto", "ficha", "cartao", "numeros"] as const;
export type LayoutDoCartao = (typeof LAYOUTS_DO_CARTAO)[number];

export function gerarCartao(
  token: string,
  postId: string,
  formato: FormatoDoCartao,
  layout: LayoutDoCartao = "foto"
) {
  // `layout` chega de volta na resposta porque o servidor pode trocar: sem foto
  // nao ha o que sobrepor, e qualquer escolha vira o tipografico.
  return apiFetch<{ url: string; formato: FormatoDoCartao; layout: LayoutDoCartao }>(
    `/social/posts/${postId}/cartao?formato=${formato}&layout=${layout}`,
    { method: "POST", token }
  );
}

export function getFeed(token: string) {
  return apiFetch<{ posts: Post[] }>("/social/feed", { token });
}

// Feed global (Explorar) — posts de todos, para descobrir e seguir gente nova.
// Paginação por cursor: passe `before` (ISO do último post) para a próxima página.
export function getExplore(token: string, before?: string) {
  const q = before ? `?before=${encodeURIComponent(before)}` : "";
  return apiFetch<{ posts: Post[]; nextBefore: string | null }>(`/social/explore${q}`, { token });
}

export async function getPost(token: string, id: string): Promise<Post> {
  const res = await apiFetch<{ post: Post }>(`/social/posts/${id}`, { token });
  return res.post;
}

export function likePost(token: string, id: string) {
  return apiFetch<{ liked: boolean; likeCount: number }>(`/social/posts/${id}/like`, {
    method: "POST",
    token,
  });
}

export function unlikePost(token: string, id: string) {
  return apiFetch<{ liked: boolean; likeCount: number }>(`/social/posts/${id}/like`, {
    method: "DELETE",
    token,
  });
}

export function getUserProfile(token: string, id: string) {
  return apiFetch<UserProfile>(`/social/users/${id}`, { token });
}

export function getUserActivities(token: string, id: string, cursor?: string | null) {
  const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiFetch<{ data: TreinoPublico[]; meta: { nextCursor: string | null } }>(
    `/social/users/${id}/activities${q}`,
    { token }
  );
}

export function followUser(token: string, id: string) {
  return apiFetch<{ following: boolean }>(`/social/users/${id}/follow`, {
    method: "POST",
    token,
  });
}

export function unfollowUser(token: string, id: string) {
  return apiFetch<{ following: boolean }>(`/social/users/${id}/follow`, {
    method: "DELETE",
    token,
  });
}

export function getComments(token: string, postId: string) {
  return apiFetch<{ comments: Comment[] }>(`/social/posts/${postId}/comments`, { token });
}

export function createComment(token: string, postId: string, text: string) {
  return apiFetch<{ comment: Comment }>(`/social/posts/${postId}/comments`, {
    method: "POST",
    token,
    body: { text },
  });
}

export function searchUsers(token: string, q: string) {
  return apiFetch<{ users: SearchUser[] }>(`/social/search?q=${encodeURIComponent(q)}`, { token });
}

/* ---------- controle do próprio post e denúncia ---------- */

export const MOTIVOS_DE_DENUNCIA = [
  { chave: "spam", rotulo: "Spam" },
  { chave: "ofensivo", rotulo: "Conteúdo ofensivo" },
  { chave: "assedio", rotulo: "Assédio" },
  { chave: "improprio", rotulo: "Conteúdo impróprio" },
  { chave: "odio", rotulo: "Discurso de ódio" },
  { chave: "enganoso", rotulo: "Informação enganosa" },
  { chave: "outro", rotulo: "Outro motivo" },
] as const;

export function editarPost(token: string, id: string, text: string) {
  return apiFetch<{ data: Post }>(`/social/posts/${id}`, { method: "PATCH", token, body: { text } });
}

export function excluirPost(token: string, id: string) {
  return apiFetch<{ data: { excluido: boolean } }>(`/social/posts/${id}`, { method: "DELETE", token });
}

export function denunciarPost(token: string, id: string, reason: string, details?: string) {
  return apiFetch<{ data: { enviada: boolean } }>(`/social/posts/${id}/report`, {
    method: "POST",
    token,
    body: { reason, details },
  });
}
