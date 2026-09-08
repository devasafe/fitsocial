import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { Challenge, challengeCreateSchema, generateJoinCode } from "../models/Challenge.js";
import { ChallengeMember } from "../models/ChallengeMember.js";
import { User } from "../models/User.js";
import { computeScores } from "../services/challengeScore.js";

export const challengesRouter = Router();
challengesRouter.use(requireAuth);

function assertId(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(400, "ID inválido");
}

function serialize(c: InstanceType<typeof Challenge>, memberCount?: number) {
  return {
    id: c._id.toString(),
    name: c.name,
    description: c.description,
    startAt: c.startAt,
    endAt: c.endAt,
    joinCode: c.joinCode,
    scoreMode: c.scoreMode,
    sportIds: c.sportIds,
    visibility: c.visibility,
    creator: c.creator.toString(),
    ...(memberCount != null ? { memberCount } : {}),
  };
}

async function withCount(c: InstanceType<typeof Challenge>) {
  return serialize(c, await ChallengeMember.countDocuments({ challenge: c._id }));
}

// Criar desafio (o criador entra automaticamente).
challengesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = challengeCreateSchema.parse(req.body);
    const joinCode = await generateJoinCode();
    const c = await Challenge.create({ creator: req.user!._id, ...input, joinCode });
    await ChallengeMember.create({ challenge: c._id, user: req.user!._id });
    res.status(201).json({ data: serialize(c, 1) });
  })
);

// Entrar por código.
challengesRouter.post(
  "/join",
  asyncHandler(async (req, res) => {
    const { code } = z.object({ code: z.string().min(1) }).parse(req.body);
    const c = await Challenge.findOne({ joinCode: code.trim().toUpperCase() });
    if (!c) throw new HttpError(404, "Desafio não encontrado");
    await ChallengeMember.updateOne(
      { challenge: c._id, user: req.user!._id },
      { $setOnInsert: { challenge: c._id, user: req.user!._id, joinedAt: new Date() } },
      { upsert: true }
    );
    res.status(201).json({ data: await withCount(c) });
  })
);

// Meus desafios.
challengesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const memberships = await ChallengeMember.find({ user: req.user!._id }).select("challenge");
    const ids = memberships.map((m) => m.challenge);
    const challenges = await Challenge.find({ _id: { $in: ids } }).sort({ endAt: 1 });
    res.json({ data: await Promise.all(challenges.map(withCount)) });
  })
);

// Descobrir desafios públicos em aberto.
challengesRouter.get(
  "/discover",
  asyncHandler(async (req, res) => {
    const challenges = await Challenge.find({ visibility: "public", endAt: { $gte: new Date() } })
      .sort({ endAt: 1 })
      .limit(30);
    res.json({ data: await Promise.all(challenges.map(withCount)) });
  })
);

// Ranking (pontuação automática pelas atividades).
challengesRouter.get(
  "/:id/leaderboard",
  asyncHandler(async (req, res) => {
    assertId(req.params.id);
    const c = await Challenge.findById(req.params.id);
    if (!c) throw new HttpError(404, "Desafio não encontrado");

    const members = await ChallengeMember.find({ challenge: c._id }).select("user");
    const userIds = members.map((m) => m.user);
    const scores = await computeScores(c, userIds);
    const users = await User.find({ _id: { $in: userIds } }).select("name username avatarUrl");
    const me = req.user!._id.toString();

    const board = users
      .map((u) => ({
        userId: u._id.toString(),
        name: u.name,
        username: u.username ?? null,
        avatarUrl: u.avatarUrl ?? "",
        score: scores.get(u._id.toString()) ?? 0,
        isMe: u._id.toString() === me,
      }))
      .sort((a, b) => b.score - a.score)
      .map((r, i) => ({ ...r, position: i + 1 }));

    res.json({ data: board });
  })
);

// Detalhe.
challengesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    assertId(req.params.id);
    const c = await Challenge.findById(req.params.id);
    if (!c) throw new HttpError(404, "Desafio não encontrado");
    const [memberCount, isMember] = await Promise.all([
      ChallengeMember.countDocuments({ challenge: c._id }),
      ChallengeMember.exists({ challenge: c._id, user: req.user!._id }),
    ]);
    res.json({ data: { ...serialize(c, memberCount), isMember: Boolean(isMember) } });
  })
);
