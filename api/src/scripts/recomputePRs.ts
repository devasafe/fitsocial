import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Activity } from "../models/Activity.js";
import { recomputeStrengthPRs } from "../services/prEngine.js";

// Reconstrói os PRs de força de todos os usuários a partir do histórico.
// Use após a migração do WorkoutLog para semear a linha de base.
// `tsx src/scripts/recomputePRs.ts`
if (process.argv[1]?.includes("recomputePRs")) {
  connectDB()
    .then(async () => {
      const userIds = (await Activity.distinct("user", { kind: "strength" })) as mongoose.Types.ObjectId[];
      for (const userId of userIds) {
        await recomputeStrengthPRs(userId);
      }
      console.log(`[pr] recomputado para ${userIds.length} usuário(s)`);
      await mongoose.disconnect();
    })
    .catch((err) => {
      console.error("[pr] falhou:", err);
      process.exit(1);
    });
}
