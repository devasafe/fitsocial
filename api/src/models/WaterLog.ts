import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";
import { z } from "zod";

// Um registro de ingestão de água (um gole/copo/garrafa) num dia.
export const waterLogCreateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (use yyyy-mm-dd)"),
  ml: z.number().int().min(1).max(5000),
});

const waterLogSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    date: { type: String, required: true, index: true }, // yyyy-mm-dd (local do app)
    ml: { type: Number, required: true },
  },
  { timestamps: true }
);

export type WaterLogDoc = HydratedDocument<InferSchemaType<typeof waterLogSchema>>;

export const WaterLog = mongoose.model("WaterLog", waterLogSchema);
