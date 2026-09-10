import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";

const postSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // Opcional: um post pode ser só foto ou só treino (validação de "ao menos um" na rota).
    text: { type: String, default: "", trim: true, maxlength: 2000 },
    // MVP: URL da imagem (upload real de arquivo fica para uma etapa posterior).
    imageUrl: { type: String, default: "" },
    // Quando o post é o compartilhamento de uma atividade registrada (opcional).
    activity: { type: Schema.Types.ObjectId, ref: "Activity", default: undefined },
    // Denormalizados para o feed não precisar contar a cada leitura.
    likeCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
    // Escondido pela moderação de conta. Não é exclusão: desbanir devolve tudo.
    hidden: { type: Boolean, default: false, index: true },
    /** Primeira edição do texto. O app mostra "(editado)" a partir daqui. */
    editedAt: { type: Date, default: null },
    /** Exclusão lógica.
     *
     *  Para quem usa, é exclusão: o post some de tudo no mesmo instante. A
     *  linha fica porque uma denúncia em análise precisa do conteúdo, e porque
     *  curtidas, comentários e notificações que apontam para cá precisam de um
     *  destino que responda "não está mais disponível" em vez de quebrar. */
    deletedAt: { type: Date, default: null, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// Série temporal do painel varre por data. Sem este índice, contar posts por
// dia significa percorrer a coleção inteira.
postSchema.index({ createdAt: -1 });

export type PostDoc = HydratedDocument<InferSchemaType<typeof postSchema>>;

export const Post = mongoose.model("Post", postSchema);
