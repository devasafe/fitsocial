import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { User } from "../models/User.js";
import { Post } from "../models/Post.js";
import { Follow } from "../models/Follow.js";
import { WorkoutLog } from "../models/WorkoutLog.js";
import { computeStats } from "../services/adherence.js";
import { computeBadges } from "../services/badges.js";

export const gamificationRouter = Router();
gamificationRouter.use(requireAuth);

const DAY = 24 * 60 * 60 * 1000;

/** Junta as estatísticas de um usuário e devolve suas badges. */
async function badgesFor(userId: mongoose.Types.ObjectId | string) {
  const [logs, posts, followers] = await Promise.all([
    WorkoutLog.find({ user: userId }).select("date"),
    Post.countDocuments({ author: userId }),
    Follow.countDocuments({ following: userId }),
  ]);
  const stats = computeStats(logs);
  return computeBadges({
    totalCheckIns: stats.total,
    streak: stats.streak,
    posts,
    followers,
  });
}

// Badges de um usuário (próprio ou de outra pessoa).
gamificationRouter.get(
  "/users/:id",
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "ID inválido");
    const badges = await badgesFor(req.params.id);
    res.json({ badges });
  })
);

// Ranking entre quem o usuário segue (+ ele mesmo), por treinos nos últimos 7 dias.
gamificationRouter.get(
  "/leaderboard",
  asyncHandler(async (req, res) => {
    const me = req.user!._id;
    const following = await Follow.find({ follower: me }).select("following");
    const ids = [...following.map((f) => f.following), me];

    const weekAgo = new Date(Date.now() - 7 * DAY);
    const agg = await WorkoutLog.aggregate<{ _id: mongoose.Types.ObjectId; week: number }>([
      { $match: { user: { $in: ids }, date: { $gte: weekAgo } } },
      { $group: { _id: "$user", week: { $sum: 1 } } },
    ]);
    const weekMap = new Map(agg.map((a) => [a._id.toString(), a.week]));

    const users = await User.find({ _id: { $in: ids } }).select("name");
    const leaderboard = users
      .map((u) => ({
        userId: u._id.toString(),
        name: u.name,
        week: weekMap.get(u._id.toString()) ?? 0,
        isMe: u._id.toString() === me.toString(),
      }))
      .sort((a, b) => b.week - a.week);

    res.json({ leaderboard });
  })
);
