import type mongoose from "mongoose";
import { Notification } from "../models/Notification.js";

// Cria uma notificação in-app. Nunca notifica a própria pessoa e nunca quebra a
// ação principal (falha é engolida).
export async function createNotification(params: {
  userId: mongoose.Types.ObjectId; // destinatário
  actorId: mongoose.Types.ObjectId; // quem gerou
  type: "like" | "comment" | "follow" | "challenge_join";
  text: string;
  targetKind?: string;
  targetId?: mongoose.Types.ObjectId;
}): Promise<void> {
  if (params.userId.toString() === params.actorId.toString()) return;
  try {
    await Notification.create({
      user: params.userId,
      actor: params.actorId,
      type: params.type,
      text: params.text,
      targetKind: params.targetKind ?? "",
      targetId: params.targetId,
    });
  } catch {
    /* notificação é best-effort */
  }
}
