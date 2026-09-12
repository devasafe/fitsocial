import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

// A conversa entre o profissional e o aluno.
//
// A thread É o vínculo: não existe conversa sem acompanhamento, e cada
// acompanhamento tem uma. Isso evita inventar um objeto "conversa" com
// participantes e regras próprias — quem pode falar já está decidido pelo
// `ProfessionalLink`, e quando o vínculo é encerrado a conversa para junto,
// sem precisar de uma segunda regra que poderia discordar da primeira.
//
// É a primeira mensagem pessoa-a-pessoa do projeto. Não há Socket.io aqui e
// nem nada em tempo real: o app busca ao abrir e ao voltar o foco, como o
// `ContadoresContext` já faz. Tempo real entra quando a conversa provar que
// precisa — e aí entra para valer, com worker e fan-out, não com um
// `setInterval` escondido.

const messageSchema = new Schema(
  {
    /** O acompanhamento a que esta conversa pertence. */
    link: { type: Schema.Types.ObjectId, ref: "ProfessionalLink", required: true },
    autor: { type: Schema.Types.ObjectId, ref: "User", required: true },
    texto: { type: String, default: "", maxlength: 2000, trim: true },
    /**
     * Foto, quando houver. Metade da conversa real é imagem: o aluno manda o
     * vídeo travado do agachamento, o coach responde apontando o quadril.
     * Passa pelo mesmo `POST /uploads` do resto do app, que já reencoda e
     * descarta o EXIF — inclusive a coordenada de GPS.
     */
    imageUrl: { type: String, default: "" },
    imageWidth: { type: Number, default: null },
    imageHeight: { type: Number, default: null },
    /** Quando o OUTRO lado leu. Null enquanto não leu. */
    lidaEm: { type: Date, default: null },
  },
  { timestamps: true }
);

// A tela é sempre "as mensagens desta conversa, das mais novas para trás".
// O `_id` desempata: duas mensagens no mesmo segundo acontecem.
messageSchema.index({ link: 1, createdAt: -1, _id: -1 });
// E o contador de não lidas, que é o que faz o painel mostrar bolinha.
messageSchema.index({ link: 1, autor: 1, lidaEm: 1 });

export type ProMessageDoc = HydratedDocument<InferSchemaType<typeof messageSchema>>;

export const ProMessage = mongoose.model("ProMessage", messageSchema);
