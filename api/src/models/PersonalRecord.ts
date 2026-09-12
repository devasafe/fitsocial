import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

// Recorde pessoal persistido. Identificado por (user, exerciseSlug, type, repRange).
// Guarda o valor anterior para o app mostrar o delta. Ver docs/ESPORTES.md §12.

const prSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sportId: { type: String, default: "" },
    // O rotulo, como a pessoa escreveu da ultima vez que bateu o recorde.
    exerciseName: { type: String, required: true },
    // A identidade. Foi por falta dela que "Supino reto" e "supino reto" viravam
    // dois recordes do mesmo exercicio. Sem `required` porque documento antigo
    // so ganha o campo no backfill (`scripts/backfillExerciseSlugs.ts`).
    exerciseSlug: { type: String, default: "" },
    type: {
      type: String,
      enum: [
        "carga_max",
        "rm_estimado",
        "carga_faixa",
        "best_dist",
        "best_time",
        "aulas",
        "horas",
        "wod_time",
        "wod_score",
        "wod_load",
        "skill_reps",
      ],
      required: true,
    },
    repRange: { type: String, default: null },
    value: { type: Number, required: true },
    unit: { type: String, default: "kg" },
    achievedAt: { type: Date, default: Date.now },
    activity: { type: Schema.Types.ObjectId, ref: "Activity" },
    previousValue: { type: Number, default: null },
    previousAchievedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Um recorde por (usuário, exercício, tipo, faixa) — pelo SLUG, não pelo nome.
//
// A troca de chave so fecha depois do backfill: enquanto houver recorde antigo
// sem `exerciseSlug`, varios documentos colidiriam em (user, "", tipo, faixa).
// Por isso o script roda `PersonalRecord.syncIndexes()` no fim, quando ja nao
// existe duplicata — e e ele que troca o indice antigo por este.
prSchema.index({ user: 1, exerciseSlug: 1, type: 1, repRange: 1 }, { unique: true });

export type PersonalRecordDoc = HydratedDocument<InferSchemaType<typeof prSchema>>;

export const PersonalRecord = mongoose.model("PersonalRecord", prSchema);
