import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";

const postSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    // MVP: URL da imagem (upload real de arquivo fica para uma etapa posterior).
    imageUrl: { type: String, default: "" },
    // Denormalizado para o feed não precisar contar likes a cada leitura.
    likeCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export type PostDoc = HydratedDocument<InferSchemaType<typeof postSchema>>;

export const Post = mongoose.model("Post", postSchema);
