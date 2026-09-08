import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";

const memberSchema = new Schema(
  {
    challenge: { type: Schema.Types.ObjectId, ref: "Challenge", required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

memberSchema.index({ challenge: 1, user: 1 }, { unique: true });

export type ChallengeMemberDoc = HydratedDocument<InferSchemaType<typeof memberSchema>>;

export const ChallengeMember = mongoose.model("ChallengeMember", memberSchema);
