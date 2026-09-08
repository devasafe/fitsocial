import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

// Recorde pessoal persistido. Identificado por (user, exerciseName, type, repRange).
// Guarda o valor anterior para o app mostrar o delta. Ver docs/ESPORTES.md §12.

const prSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sportId: { type: String, default: "" },
    exerciseName: { type: String, required: true },
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

// Um recorde por (usuário, exercício, tipo, faixa).
prSchema.index({ user: 1, exerciseName: 1, type: 1, repRange: 1 }, { unique: true });

export type PersonalRecordDoc = HydratedDocument<InferSchemaType<typeof prSchema>>;

export const PersonalRecord = mongoose.model("PersonalRecord", prSchema);
