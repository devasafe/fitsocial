import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { Challenge, challengeCreateSchema, generateJoinCode } from "../models/Challenge.js";
import { ChallengeMember } from "../models/ChallengeMember.js";
import { ChallengePost, ChallengePostLike, ChallengePostComment } from "../models/ChallengePost.js";
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

// ---- Mural do desafio (Fase 4b) ----

interface PostAuthor {
  _id: mongoose.Types.ObjectId;
  name: string;
  username?: string;
  avatarUrl?: string;
}
function serializePost(p: InstanceType<typeof ChallengePost>, likedIds: Set<string>) {
  const author = p.author as unknown as PostAuthor;
  return {
    id: p._id.toString(),
    text: p.text,
    imageUrl: p.imageUrl,
    likeCount: p.likeCount,
    commentCount: p.commentCount,
    likedByMe: likedIds.has(p._id.toString()),
    createdAt: p.get("createdAt") as Date,
    author: {
      id: author._id.toString(),
      name: author.name,
      username: author.username ?? null,
      avatarUrl: author.avatarUrl ?? "",
    },
  };
}

async function assertMember(challengeId: mongoose.Types.ObjectId, userId: mongoose.Types.ObjectId) {
  if (!(await ChallengeMember.exists({ challenge: challengeId, user: userId }))) {
    throw new HttpError(403, "Entre no desafio para participar do mural");
  }
}

// Publicar no mural (só membros).
challengesRouter.post(
  "/:id/posts",
  asyncHandler(async (req, res) => {
    assertId(req.params.id);
    const c = await Challenge.findById(req.params.id);
    if (!c) throw new HttpError(404, "Desafio não encontrado");
    await assertMember(c._id, req.user!._id);
    const { text, imageUrl } = z
      .object({ text: z.string().min(1).max(1000), imageUrl: z.string().url().optional() })
      .parse(req.body);
    const post = await ChallengePost.create({ challenge: c._id, author: req.user!._id, text, imageUrl: imageUrl ?? "" });
    await post.populate("author", "name username avatarUrl");
    res.status(201).json({ data: serializePost(post, new Set()) });
  })
);

// Ler o mural (qualquer autenticado).
challengesRouter.get(
  "/:id/posts",
  asyncHandler(async (req, res) => {
    assertId(req.params.id);
    const posts = await ChallengePost.find({ challenge: req.params.id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("author", "name username avatarUrl");
    const liked = await ChallengePostLike.find({
      user: req.user!._id,
      post: { $in: posts.map((p) => p._id) },
    }).select("post");
    const likedIds = new Set(liked.map((l) => l.post.toString()));
    res.json({ data: posts.map((p) => serializePost(p, likedIds)) });
  })
);

// Curtir / descurtir (toggle, só membros).
challengesRouter.post(
  "/:id/posts/:postId/like",
  asyncHandler(async (req, res) => {
    assertId(req.params.postId);
    const post = await ChallengePost.findById(req.params.postId);
    if (!post) throw new HttpError(404, "Post não encontrado");
    await assertMember(post.challenge, req.user!._id);
    const r = await ChallengePostLike.updateOne(
      { post: post._id, user: req.user!._id },
      { $setOnInsert: { post: post._id, user: req.user!._id } },
      { upsert: true }
    );
    if (r.upsertedCount) {
      post.likeCount += 1;
      await post.save();
    }
    res.json({ liked: true, likeCount: post.likeCount });
  })
);
challengesRouter.delete(
  "/:id/posts/:postId/like",
  asyncHandler(async (req, res) => {
    assertId(req.params.postId);
    const post = await ChallengePost.findById(req.params.postId);
    if (!post) throw new HttpError(404, "Post não encontrado");
    const r = await ChallengePostLike.deleteOne({ post: post._id, user: req.user!._id });
    if (r.deletedCount && post.likeCount > 0) {
      post.likeCount -= 1;
      await post.save();
    }
    res.json({ liked: false, likeCount: post.likeCount });
  })
);

// Comentar num post do mural (só membros).
challengesRouter.post(
  "/:id/posts/:postId/comments",
  asyncHandler(async (req, res) => {
    assertId(req.params.postId);
    const post = await ChallengePost.findById(req.params.postId);
    if (!post) throw new HttpError(404, "Post não encontrado");
    await assertMember(post.challenge, req.user!._id);
    const { text } = z.object({ text: z.string().min(1).max(500) }).parse(req.body);
    const comment = await ChallengePostComment.create({ post: post._id, author: req.user!._id, text });
    post.commentCount += 1;
    await post.save();
    await comment.populate("author", "name");
    const a = comment.author as unknown as PostAuthor;
    res.status(201).json({
      data: { id: comment._id.toString(), text: comment.text, createdAt: comment.get("createdAt") as Date, author: { id: a._id.toString(), name: a.name } },
    });
  })
);

// Listar comentários de um post.
challengesRouter.get(
  "/:id/posts/:postId/comments",
  asyncHandler(async (req, res) => {
    assertId(req.params.postId);
    const comments = await ChallengePostComment.find({ post: req.params.postId })
      .sort({ createdAt: 1 })
      .limit(200)
      .populate("author", "name");
    res.json({
      data: comments.map((c) => {
        const a = c.author as unknown as PostAuthor;
        return { id: c._id.toString(), text: c.text, createdAt: c.get("createdAt") as Date, author: { id: a._id.toString(), name: a.name } };
      }),
    });
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
