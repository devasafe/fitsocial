import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";

// Uma linha por pessoa por dia em que ela ABRIU o app — diferente de ter
// escrito algo. Sem isto, quem entra, olha o treino e sai não conta como ativo.
//
// `dia` é string yyyy-mm-dd no fuso de São Paulo, como FoodLog e WaterLog já
// fazem. Guardar o dia resolvido evita recalcular fuso em toda leitura e deixa
// o índice único fazer o trabalho de "uma marcação por dia".
const userDailyActiveSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    dia: { type: String, required: true },
    primeiroAcesso: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

userDailyActiveSchema.index({ user: 1, dia: 1 }, { unique: true });
userDailyActiveSchema.index({ dia: 1 });

export type UserDailyActiveDoc = HydratedDocument<InferSchemaType<typeof userDailyActiveSchema>>;

export const UserDailyActive = mongoose.model("UserDailyActive", userDailyActiveSchema);
