import { apiFetch } from "./client";

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
  movements: { name: string; loadKg: number | null; reps: number | null; timeSec: number | null }[] | null;
}
export interface Post {
  id: string;
  text: string;
  imageUrl: string;
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
  counts: { posts: number; followers: number; following: number };
  isFollowing: boolean;
  isMe: boolean;
  posts: Post[];
}

// Post: qualquer combinação de texto, foto e treino anexado (ao menos um).
export function createPost(token: string, input: { text?: string; imageUrl?: string; activityId?: string }) {
  return apiFetch<{ post: Post }>("/social/posts", { method: "POST", token, body: input });
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
