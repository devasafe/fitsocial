import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";

const postSchema = new Schema(
  {
    challenge: { type: Schema.Types.ObjectId, ref: "Challenge", required: true, index: true },
    author: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    imageUrl: { type: String, default: "" },
    likeCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export type ChallengePostDoc = HydratedDocument<InferSchemaType<typeof postSchema>>;
export const ChallengePost = mongoose.model("ChallengePost", postSchema);

const likeSchema = new Schema(
  {
    post: { type: Schema.Types.ObjectId, ref: "ChallengePost", required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  },
  { timestamps: true }
);
likeSchema.index({ post: 1, user: 1 }, { unique: true });

export const ChallengePostLike = mongoose.model("ChallengePostLike", likeSchema);
