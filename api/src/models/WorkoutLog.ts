import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from "mongoose";
import { z } from "zod";

// Uma entrada por exercício com a carga e reps realmente feitos.
export const logEntrySchema = z.object({
  exerciseName: z.string().min(1),
  weightKg: z.number().min(0).max(1000),
  reps: z.number().int().min(0).max(1000),
});

export const createLogSchema = z.object({
  sessionDay: z.string().min(1),
  entries: z.array(logEntrySchema).min(1),
  notes: z.string().max(500).optional(),
  shareToFeed: z.boolean().optional(),
  shareText: z.string().max(2000).optional(),
});

const workoutLogSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    planVersion: { type: Number, default: 0 },
    sessionDay: { type: String, required: true },
    date: { type: Date, default: Date.now, index: true },
    entries: [
      {
        exerciseName: { type: String, required: true },
        weightKg: { type: Number, required: true },
        reps: { type: Number, required: true },
        _id: false,
      },
    ],
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

export type WorkoutLogDoc = HydratedDocument<InferSchemaType<typeof workoutLogSchema>>;

export const WorkoutLog = mongoose.model("WorkoutLog", workoutLogSchema);
