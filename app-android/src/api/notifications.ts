import { apiFetch } from "./client";

export interface NotificationItem {
  id: string;
  type: "like" | "comment" | "follow" | "challenge_join";
  text: string;
  read: boolean;
  createdAt: string;
  targetKind: string;
  targetId: string | null;
  actor: { id: string; name: string; avatarUrl: string };
}

export async function listNotifications(token: string): Promise<{ data: NotificationItem[]; unread: number }> {
  return apiFetch<{ data: NotificationItem[]; unread: number }>("/notifications", { token });
}
export async function markNotificationsRead(token: string): Promise<void> {
  await apiFetch("/notifications/read", { method: "POST", token });
}
