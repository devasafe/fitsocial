import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

// Cada recorde batido, um documento, para sempre.
//
// `PersonalRecord` guarda o ESTADO: o melhor de cada exercício agora, mais um
// único nível de anterior (`previousValue`). Isso responde "qual é o meu
// recorde", mas não "como eu cheguei até aqui" — e era só isso que dava para
// mostrar: um número, sem data, sem antes.
//
// Aqui é o contrário: nada é sobrescrito, nada é apagado quando um recorde novo
// vem. É a linha do tempo das conquistas, que é o que a pessoa relê para ver
// que está evoluindo.
//
// Só entra recorde SUPERADO. A primeira vez que alguém faz um exercício não
// vira evento: é linha de base, não conquista — a mesma regra que o motor já
// usa para não celebrar o primeiro treino.

const eventoSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sportId: { type: String, default: "" },
    /** A identidade — a mesma chave de `PersonalRecord`. */
    exerciseSlug: { type: String, required: true },
    /** O rótulo, como a pessoa escreveu no dia em que bateu. */
    exerciseName: { type: String, required: true },
    type: { type: String, required: true },
    repRange: { type: String, default: null },
    value: { type: Number, required: true },
    /** O que ele superou. Sempre existe: sem anterior não há recorde batido. */
    previousValue: { type: Number, required: true },
    unit: { type: String, default: "kg" },
    activity: { type: Schema.Types.ObjectId, ref: "Activity" },
    achievedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// A tela é sempre "as minhas conquistas, da mais recente para trás".
//
// O `_id` entra como última chave porque é assim que a paginação ordena
// (`achievedAt: -1, _id: -1`): um treino bate carga máxima e 1RM no mesmo
// instante, e sem o desempate no índice o planner teria de ordenar em memória —
// a paginação por cursor deixaria de ser servida por índice justamente na
// coleção que mais cresce.
eventoSchema.index({ user: 1, achievedAt: -1, _id: -1 });
// E o gráfico de um exercício marca os pontos em que houve recorde.
eventoSchema.index({ user: 1, exerciseSlug: 1, achievedAt: -1, _id: -1 });

export type PersonalRecordEventDoc = HydratedDocument<InferSchemaType<typeof eventoSchema>>;

export const PersonalRecordEvent = mongoose.model("PersonalRecordEvent", eventoSchema);
