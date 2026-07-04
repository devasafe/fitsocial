import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";

// Histórico persistente da conversa entre o usuário e o coach IA.
const coachMessageSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
  },
  { timestamps: true }
);

export type CoachMessageDoc = HydratedDocument<InferSchemaType<typeof coachMessageSchema>>;

export const CoachMessage = mongoose.model("CoachMessage", coachMessageSchema);
