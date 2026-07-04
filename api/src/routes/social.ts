import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { User } from "../models/User.js";
import { Post } from "../models/Post.js";
import { Follow } from "../models/Follow.js";
import { Like } from "../models/Like.js";

export const socialRouter = Router();
socialRouter.use(requireAuth);

// ---- helpers ----

interface PopulatedAuthor {
  _id: mongoose.Types.ObjectId;
  name: string;
}

function serializePost(
  post: InstanceType<typeof Post>,
  likedIds: Set<string>
) {
  const author = post.author as unknown as PopulatedAuthor;
  return {
    id: post._id.toString(),
    text: post.text,
    imageUrl: post.imageUrl,
    likeCount: post.likeCount,
    likedByMe: likedIds.has(post._id.toString()),
    createdAt: post.get("createdAt") as Date,
    author: { id: author._id.toString(), name: author.name },
  };
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

const createPostSchema = z.object({
  text: z.string().min(1, "Escreva algo").max(2000),
  imageUrl: z.string().url("URL de imagem inválida").optional(),
});

socialRouter.post(
  "/posts",
  asyncHandler(async (req, res) => {
    const { text, imageUrl } = createPostSchema.parse(req.body);
    const post = await Post.create({ author: req.user!._id, text, imageUrl: imageUrl ?? "" });
    await post.populate("author", "name");
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

    const posts = await Post.find({ author: { $in: authorIds } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("author", "name");

    const likedIds = await likedSetFor(me, posts.map((p) => p._id));
    res.json({ posts: posts.map((p) => serializePost(p, likedIds)) });
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

    await Follow.updateOne(
      { follower: req.user!._id, following: target._id },
      { $setOnInsert: { follower: req.user!._id, following: target._id } },
      { upsert: true }
    );
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
    const user = await User.findById(req.params.id).select("name");
    if (!user) throw new HttpError(404, "Usuário não encontrado");

    const [posts, followers, following, isFollowing] = await Promise.all([
      Post.find({ author: user._id }).sort({ createdAt: -1 }).limit(30).populate("author", "name"),
      Follow.countDocuments({ following: user._id }),
      Follow.countDocuments({ follower: user._id }),
      Follow.exists({ follower: me, following: user._id }),
    ]);

    const likedIds = await likedSetFor(me, posts.map((p) => p._id));
    res.json({
      user: { id: user._id.toString(), name: user.name },
      counts: { posts: posts.length, followers, following },
      isFollowing: Boolean(isFollowing),
      isMe: user._id.toString() === me.toString(),
      posts: posts.map((p) => serializePost(p, likedIds)),
    });
  })
);
