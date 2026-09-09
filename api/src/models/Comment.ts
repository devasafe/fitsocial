import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";

const commentSchema = new Schema(
  {
    post: { type: Schema.Types.ObjectId, ref: "Post", required: true, index: true },
    author: { type: Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    // Escondido pela moderação. Não é exclusão: desbanir devolve tudo.
    hidden: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

// Série temporal do painel varre por data. Sem este índice, contar posts por
// dia significa percorrer a coleção inteira.
commentSchema.index({ createdAt: -1 });

export type CommentDoc = HydratedDocument<InferSchemaType<typeof commentSchema>>;

export const Comment = mongoose.model("Comment", commentSchema);
