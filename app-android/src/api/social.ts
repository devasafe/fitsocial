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

export function createPost(token: string, text: string, imageUrl?: string) {
  return apiFetch<{ post: Post }>("/social/posts", {
    method: "POST",
    token,
    body: { text, ...(imageUrl ? { imageUrl } : {}) },
  });
}

export function getFeed(token: string) {
  return apiFetch<{ posts: Post[] }>("/social/feed", { token });
}

// Feed global (Explorar) — posts de todos, para descobrir e seguir gente nova.
export function getExplore(token: string) {
  return apiFetch<{ posts: Post[] }>("/social/explore", { token });
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
