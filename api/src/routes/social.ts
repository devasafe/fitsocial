import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { User } from "../models/User.js";
import { Post } from "../models/Post.js";
import { Activity } from "../models/Activity.js";
import { Follow } from "../models/Follow.js";
import { Like } from "../models/Like.js";
import { Comment } from "../models/Comment.js";
import { createNotification } from "../services/notifications.js";
import { getSport } from "../services/sports.js";

export const socialRouter = Router();
socialRouter.use(requireAuth);

// ---- busca de pessoas ----

socialRouter.get(
  "/search",
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.json({ users: [] });
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // escapa regex
    const rx = new RegExp(safe, "i");
    const me = req.user!._id;
    const users = await User.find({
      _id: { $ne: me },
      $or: [{ username: rx }, { name: rx }],
    })
      .select("name username avatarUrl")
      .limit(20);

    const followingIds = new Set(
      (await Follow.find({ follower: me, following: { $in: users.map((u) => u._id) } }).select("following"))
        .map((f) => f.following.toString())
    );

    res.json({
      users: users.map((u) => ({
        id: u._id.toString(),
        name: u.name,
        username: u.username ?? null,
        avatarUrl: u.avatarUrl ?? "",
        isFollowing: followingIds.has(u._id.toString()),
      })),
    });
  })
);

// ---- helpers ----

interface PopulatedAuthor {
  _id: mongoose.Types.ObjectId;
  name: string;
  username?: string;
  avatarUrl?: string;
}

function serializePost(
  post: InstanceType<typeof Post>,
  likedIds: Set<string>,
  opts?: { followingIds?: Set<string>; meId?: string }
) {
  const author = post.author as unknown as PopulatedAuthor;
  const authorId = author._id.toString();
  return {
    id: post._id.toString(),
    text: post.text,
    imageUrl: post.imageUrl,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    likedByMe: likedIds.has(post._id.toString()),
    createdAt: post.get("createdAt") as Date,
    author: {
      id: authorId,
      name: author.name,
      username: author.username ?? null,
      avatarUrl: author.avatarUrl ?? "",
      // Preenchidos onde há contexto de descoberta (ex.: explore) — senão false.
      isMe: opts?.meId ? authorId === opts.meId : false,
      isFollowing: opts?.followingIds ? opts.followingIds.has(authorId) : false,
    },
    // Resumo da atividade vinculada (quando o post é um compartilhamento e a
    // query populou `activity`) — hoje carrega os movimentos do WOD para o card.
    activity: activitySummary(post),
  };
}

function mmss(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.round(totalSec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface WodMovement {
  name: string;
  loadKg?: number | null;
  reps?: number | null;
  timeSec?: number | null;
}
interface ActivityPayload {
  name?: string;
  level?: string;
  activityName?: string;
  sessionType?: string;
  exercises?: unknown[];
  movements?: WodMovement[];
  resultTimeSec?: number | null;
  resultRounds?: number | null;
  resultReps?: number | null;
  resultLoadKg?: number | null;
}
interface PopulatedActivity {
  _id: mongoose.Types.ObjectId;
  kind: string;
  sportId: string;
  durationSec?: number;
  metrics?: Record<string, number>;
  payload?: ActivityPayload;
}

// Resumo do treino para o card do feed — genérico por kind (title + stats + movimentos do WOD).
function activitySummary(post: InstanceType<typeof Post>) {
  const act = post.activity as unknown;
  if (!act || typeof act !== "object" || !("kind" in act)) return null;
  const a = act as PopulatedActivity;
  const pl = a.payload ?? {};
  const m = a.metrics ?? {};
  const dur = a.durationSec ?? 0;
  const label = getSport(a.sportId)?.label ?? a.sportId;

  let title = label;
  const stats: string[] = [];
  let movements: WodMovement[] | null = null;

  if (a.kind === "strength") {
    const n = Array.isArray(pl.exercises) ? pl.exercises.length : 0;
    if (n) stats.push(`${n} exercício${n > 1 ? "s" : ""}`);
    if (m.volumeTotalKg) stats.push(`${Math.round(m.volumeTotalKg)} kg`);
    if (dur) stats.push(mmss(dur));
  } else if (a.kind === "endurance") {
    if (m.distanceKm) stats.push(`${Math.round(m.distanceKm * 100) / 100} km`);
    if (dur) stats.push(mmss(dur));
    if (m.avgPaceSecPerKm) stats.push(`${mmss(m.avgPaceSecPerKm)} /km`);
  } else if (a.kind === "class") {
    if (m.minutes) stats.push(`${Math.round(m.minutes)} min`);
    else if (dur) stats.push(mmss(dur));
    if (pl.sessionType) stats.push(String(pl.sessionType));
  } else if (a.kind === "wod") {
    title = pl.name || label;
    if (pl.level) stats.push(String(pl.level).toUpperCase());
    const result =
      pl.resultTimeSec != null
        ? mmss(pl.resultTimeSec)
        : pl.resultRounds != null
          ? `${pl.resultRounds} rounds`
          : pl.resultReps != null
            ? `${pl.resultReps} reps`
            : pl.resultLoadKg != null
              ? `${pl.resultLoadKg} kg`
              : null;
    if (result) stats.push(result);
    movements = Array.isArray(pl.movements)
      ? pl.movements.map((mv) => ({
          name: mv.name,
          loadKg: mv.loadKg ?? null,
          reps: mv.reps ?? null,
          timeSec: mv.timeSec ?? null,
        }))
      : null;
  } else {
    // generic
    if (pl.activityName) title = String(pl.activityName);
    if (m.minutes) stats.push(`${Math.round(m.minutes)} min`);
    else if (dur) stats.push(mmss(dur));
  }

  return { id: a._id.toString(), kind: a.kind, sportId: a.sportId, title, stats, movements };
}

/** Dado um conjunto de posts, retorna o set de ids que o usuário curtiu. */
async function likedSetFor(userId: mongoose.Types.ObjectId, postIds: mongoose.Types.ObjectId[]) {
  const likes = await Like.find({ user: userId, post: { $in: postIds } }).select("post");
  return new Set(likes.map((l) => l.post.toString()));
}

function assertObjectId(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(400, "ID inválido");
}

// ---- posts ----

const createPostSchema = z
  .object({
    text: z.string().max(2000).optional(),
    imageUrl: z.string().url("URL de imagem inválida").optional(),
    activityId: z.string().optional(),
  })
  .refine((b) => !!(b.text?.trim() || b.imageUrl || b.activityId), {
    message: "Escreva algo, adicione uma foto ou anexe um treino",
  });

socialRouter.post(
  "/posts",
  asyncHandler(async (req, res) => {
    const { text, imageUrl, activityId } = createPostSchema.parse(req.body);

    // Anexo de treino: precisa existir e ser do próprio usuário.
    let activity: mongoose.Types.ObjectId | undefined;
    if (activityId) {
      assertObjectId(activityId);
      const act = await Activity.findOne({ _id: activityId, user: req.user!._id }).select("_id");
      if (!act) throw new HttpError(404, "Treino não encontrado");
      activity = act._id;
    }

    const post = await Post.create({
      author: req.user!._id,
      text: text?.trim() ?? "",
      imageUrl: imageUrl ?? "",
      ...(activity ? { activity } : {}),
    });
    await post.populate("author", "name username avatarUrl");
    if (activity) await post.populate("activity", "kind sportId payload metrics durationSec title");
    res.status(201).json({ post: serializePost(post, new Set()) });
  })
);

// Feed: posts de quem o usuário segue + os próprios, do mais novo ao mais antigo.
socialRouter.get(
  "/feed",
  asyncHandler(async (req, res) => {
    const me = req.user!._id;
    const limit = Math.min(Number(req.query.limit) || 30, 50);

    const following = await Follow.find({ follower: me }).select("following");
    const authorIds = [...following.map((f) => f.following), me];

    const posts = await Post.find({ author: { $in: authorIds }, hidden: { $ne: true } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("author", "name username avatarUrl")
      .populate("activity", "kind sportId payload metrics durationSec title");

    const likedIds = await likedSetFor(me, posts.map((p) => p._id));
    res.json({ posts: posts.map((p) => serializePost(p, likedIds)) });
  })
);

// Explorar: posts de TODOS (descoberta), mais novos primeiro. Post só existe
// quando o usuário publica/compartilha, então o timeline global é seguro.
socialRouter.get(
  "/explore",
  asyncHandler(async (req, res) => {
    const me = req.user!._id;
    const limit = Math.min(Number(req.query.limit) || 50, 50);
    // Paginação por cursor: ?before=<ISO do createdAt do último post da página anterior>.
    const before = String(req.query.before ?? "");
    const filter: mongoose.FilterQuery<typeof Post> =
      before && !Number.isNaN(Date.parse(before)) ? { createdAt: { $lt: new Date(before) } } : {};
    // Conteúdo escondido pela moderação não aparece na descoberta.
    filter.hidden = { $ne: true };

    const posts = await Post.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("author", "name username avatarUrl")
      .populate("activity", "kind sportId payload metrics durationSec title");

    const authorIds = posts.map((p) => (p.author as unknown as { _id: mongoose.Types.ObjectId })._id);
    const [likedIds, follows] = await Promise.all([
      likedSetFor(me, posts.map((p) => p._id)),
      Follow.find({ follower: me, following: { $in: authorIds } }).select("following"),
    ]);
    const followingIds = new Set(follows.map((f) => f.following.toString()));
    const meId = me.toString();
    // Só há próxima página se veio a página cheia.
    const nextBefore = posts.length === limit ? (posts[posts.length - 1].get("createdAt") as Date).toISOString() : null;
    res.json({ posts: posts.map((p) => serializePost(p, likedIds, { followingIds, meId })), nextBefore });
  })
);

// Post único (usado pelo deep-link das notificações, que só carrega o id).
socialRouter.get(
  "/posts/:id",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    const post = await Post.findById(req.params.id).populate("author", "name username avatarUrl")
      .populate("activity", "kind sportId payload metrics durationSec title");
    // Post escondido responde 404 para terceiros: existir e negar já entrega
    // que existe. O autor continua vendo o próprio conteúdo.
    if (!post || (post.hidden && !post.author._id.equals(req.user!._id))) {
      throw new HttpError(404, "Post não encontrado");
    }
    const likedIds = await likedSetFor(req.user!._id, [post._id]);
    res.json({ post: serializePost(post, likedIds) });
  })
);

// ---- curtidas (toggle) ----

socialRouter.post(
  "/posts/:id/like",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    const post = await Post.findById(req.params.id);
    if (!post) throw new HttpError(404, "Post não encontrado");

    const result = await Like.updateOne(
      { user: req.user!._id, post: post._id },
      { $setOnInsert: { user: req.user!._id, post: post._id } },
      { upsert: true }
    );
    if (result.upsertedCount) {
      post.likeCount += 1;
      await post.save();
      await createNotification({
        userId: post.author,
        actorId: req.user!._id,
        type: "like",
        text: `${req.user!.name} curtiu seu post`,
        targetKind: "post",
        targetId: post._id,
      });
    }
    res.json({ liked: true, likeCount: post.likeCount });
  })
);

socialRouter.delete(
  "/posts/:id/like",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    const post = await Post.findById(req.params.id);
    if (!post) throw new HttpError(404, "Post não encontrado");

    const result = await Like.deleteOne({ user: req.user!._id, post: post._id });
    if (result.deletedCount && post.likeCount > 0) {
      post.likeCount -= 1;
      await post.save();
    }
    res.json({ liked: false, likeCount: post.likeCount });
  })
);

// ---- seguir (toggle) ----

socialRouter.post(
  "/users/:id/follow",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    const targetId = req.params.id;
    if (targetId === req.user!._id.toString()) {
      throw new HttpError(400, "Você não pode seguir a si mesmo");
    }
    const target = await User.findById(targetId);
    if (!target) throw new HttpError(404, "Usuário não encontrado");

    const followResult = await Follow.updateOne(
      { follower: req.user!._id, following: target._id },
      { $setOnInsert: { follower: req.user!._id, following: target._id } },
      { upsert: true }
    );
    if (followResult.upsertedCount) {
      await createNotification({
        userId: target._id,
        actorId: req.user!._id,
        type: "follow",
        text: `${req.user!.name} começou a te seguir`,
        targetKind: "profile",
        targetId: req.user!._id,
      });
    }
    res.json({ following: true });
  })
);

socialRouter.delete(
  "/users/:id/follow",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    await Follow.deleteOne({ follower: req.user!._id, following: req.params.id });
    res.json({ following: false });
  })
);

// ---- perfil público ----

socialRouter.get(
  "/users/:id",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    const me = req.user!._id;
    const user = await User.findById(req.params.id).select("name username avatarUrl bio");
    if (!user) throw new HttpError(404, "Usuário não encontrado");

    const [posts, followers, following, isFollowing] = await Promise.all([
      Post.find({ author: user._id, ...(user._id.equals(me) ? {} : { hidden: { $ne: true } }) })
        .sort({ createdAt: -1 }).limit(30).populate("author", "name username avatarUrl")
      .populate("activity", "kind sportId payload metrics durationSec title"),
      Follow.countDocuments({ following: user._id }),
      Follow.countDocuments({ follower: user._id }),
      Follow.exists({ follower: me, following: user._id }),
    ]);

    const likedIds = await likedSetFor(me, posts.map((p) => p._id));
    res.json({
      user: {
        id: user._id.toString(),
        name: user.name,
        username: user.username ?? null,
        avatarUrl: user.avatarUrl ?? "",
        bio: user.bio ?? "",
      },
      counts: { posts: posts.length, followers, following },
      isFollowing: Boolean(isFollowing),
      isMe: user._id.toString() === me.toString(),
      posts: posts.map((p) => serializePost(p, likedIds)),
    });
  })
);

// ---- comentários ----

const createCommentSchema = z.object({ text: z.string().min(1, "Escreva algo").max(1000) });

function serializeComment(comment: InstanceType<typeof Comment>) {
  const author = comment.author as unknown as PopulatedAuthor;
  return {
    id: comment._id.toString(),
    text: comment.text,
    createdAt: comment.get("createdAt") as Date,
    author: { id: author._id.toString(), name: author.name },
  };
}

// Cria um comentário e incrementa a contagem do post.
socialRouter.post(
  "/posts/:id/comments",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    const { text } = createCommentSchema.parse(req.body);
    const post = await Post.findById(req.params.id);
    if (!post) throw new HttpError(404, "Post não encontrado");

    const comment = await Comment.create({ post: post._id, author: req.user!._id, text });
    post.commentCount += 1;
    await post.save();
    await createNotification({
      userId: post.author,
      actorId: req.user!._id,
      type: "comment",
      text: `${req.user!.name} comentou no seu post`,
      targetKind: "post",
      targetId: post._id,
    });

    await comment.populate("author", "name");
    res.status(201).json({ comment: serializeComment(comment) });
  })
);

// Lista os comentários de um post (mais antigos primeiro).
socialRouter.get(
  "/posts/:id/comments",
  asyncHandler(async (req, res) => {
    assertObjectId(req.params.id);
    const comments = await Comment.find({ post: req.params.id, hidden: { $ne: true } })
      .sort({ createdAt: 1 })
      .limit(200)
      .populate("author", "name");
    res.json({ comments: comments.map(serializeComment) });
  })
);
