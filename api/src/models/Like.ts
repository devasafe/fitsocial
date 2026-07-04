import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";

const likeSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    post: { type: Schema.Types.ObjectId, ref: "Post", required: true, index: true },
  },
  { timestamps: true }
);

// Um usuário só pode curtir um post uma vez.
likeSchema.index({ user: 1, post: 1 }, { unique: true });

export type LikeDoc = HydratedDocument<InferSchemaType<typeof likeSchema>>;

export const Like = mongoose.model("Like", likeSchema);
