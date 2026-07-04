import { apiFetch } from "./client";

export interface PostAuthor {
  id: string;
  name: string;
}
export interface Post {
  id: string;
  text: string;
  imageUrl: string;
  likeCount: number;
  likedByMe: boolean;
  createdAt: string;
  author: PostAuthor;
}
export interface UserProfile {
  user: { id: string; name: string };
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
