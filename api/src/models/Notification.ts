import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";

export const NOTIFICATION_TYPES = ["like", "comment", "follow", "challenge_join"] as const;

const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true }, // destinatário
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    actor: { type: Schema.Types.ObjectId, ref: "User", required: true }, // quem gerou
    text: { type: String, required: true },
    targetKind: { type: String, default: "" }, // "post" | "challenge" | "profile"
    targetId: { type: Schema.Types.ObjectId },
    read: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

export type NotificationDoc = HydratedDocument<InferSchemaType<typeof notificationSchema>>;
export const Notification = mongoose.model("Notification", notificationSchema);
