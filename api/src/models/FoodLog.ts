import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";
import { z } from "zod";

export const MEALS = ["cafe", "almoco", "lanche", "janta"] as const;

export const foodLogCreateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve ser yyyy-mm-dd"),
  meal: z.enum(MEALS),
  name: z.string().min(1).max(80),
  kcal: z.number().min(0).max(10000),
  proteinG: z.number().min(0).max(2000).default(0),
  carbsG: z.number().min(0).max(2000).default(0),
  fatG: z.number().min(0).max(2000).default(0),
});

export type FoodLogCreateInput = z.infer<typeof foodLogCreateSchema>;

const foodLogSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    date: { type: String, required: true, index: true }, // yyyy-mm-dd (fuso America/Sao_Paulo na borda)
    meal: { type: String, enum: MEALS, required: true },
    name: { type: String, required: true },
    kcal: { type: Number, default: 0 },
    proteinG: { type: Number, default: 0 },
    carbsG: { type: Number, default: 0 },
    fatG: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export type FoodLogDoc = HydratedDocument<InferSchemaType<typeof foodLogSchema>>;
export const FoodLog = mongoose.model("FoodLog", foodLogSchema);
