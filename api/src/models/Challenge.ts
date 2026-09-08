import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";
import { z } from "zod";

export const SCORE_MODES = ["checkins", "minutes", "distance"] as const;

export const challengeCreateSchema = z
  .object({
    name: z.string().min(1).max(80),
    description: z.string().max(500).optional(),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    scoreMode: z.enum(SCORE_MODES),
    sportIds: z.array(z.string()).max(30).default([]),
    visibility: z.enum(["public", "code"]).default("code"),
  })
  .refine((c) => c.endAt > c.startAt, { message: "endAt deve ser depois de startAt", path: ["endAt"] });

export type ChallengeCreateInput = z.infer<typeof challengeCreateSchema>;

const challengeSchema = new Schema(
  {
    creator: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true, index: true },
    joinCode: { type: String, required: true, unique: true, index: true },
    scoreMode: { type: String, enum: SCORE_MODES, required: true },
    sportIds: { type: [String], default: [] },
    visibility: { type: String, enum: ["public", "code"], default: "code" },
  },
  { timestamps: true }
);

export type ChallengeDoc = HydratedDocument<InferSchemaType<typeof challengeSchema>>;

export const Challenge = mongoose.model("Challenge", challengeSchema);

/** Gera um código de convite curto e único (6 caracteres A-Z0-9, sem ambíguos). */
export async function generateJoinCode(): Promise<string> {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 10; attempt++) {
    let code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    if (!(await Challenge.exists({ joinCode: code }))) return code;
  }
  throw new Error("Não foi possível gerar um código de convite");
}
