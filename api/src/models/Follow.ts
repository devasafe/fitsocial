import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";

const followSchema = new Schema(
  {
    follower: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    following: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  },
  { timestamps: true }
);

// Um usuário só pode seguir outro uma vez.
followSchema.index({ follower: 1, following: 1 }, { unique: true });

export type FollowDoc = HydratedDocument<InferSchemaType<typeof followSchema>>;

export const Follow = mongoose.model("Follow", followSchema);
