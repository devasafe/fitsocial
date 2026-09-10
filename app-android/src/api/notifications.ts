import { apiFetch } from "./client";

export type NotificationType =
  | "like"
  | "comment"
  | "follow"
  | "challenge_join"
  /** Seu post saiu do ar por moderação. */
  | "post_removido"
  /** A denúncia que você fez foi analisada. */
  | "denuncia_resolvida";

export interface NotificationItem {
  id: string;
  type: NotificationType;
  text: string;
  read: boolean;
  createdAt: string;
  /** Quando o assunto agrupou gente nova, é este o instante que importa. */
  atualizadaEm: string;
  /** Quantas pessoas estão dentro desta linha. */
  pessoas: number;
  targetKind: string;
  targetId: string | null;
  /** Nulo em aviso da moderação: a decisão é da plataforma, não de alguém. */
  actor: { id: string; name: string; avatarUrl: string } | null;
}

export async function listNotifications(token: string): Promise<{ data: NotificationItem[]; unread: number }> {
  return apiFetch<{ data: NotificationItem[]; unread: number }>("/notifications", { token });
}
export async function markNotificationsRead(token: string): Promise<void> {
  await apiFetch("/notifications/read", { method: "POST", token });
}
