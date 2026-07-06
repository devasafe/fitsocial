import { Router } from "express";
import { z } from "zod";
import { User, hashPassword, verifyPassword, publicUser } from "../models/User.js";
import { signToken } from "../utils/token.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { requireAuth } from "../middleware/auth.js";
import { usernameSchema, normalizeUsername } from "../utils/username.js";

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().min(2, "Nome muito curto").max(80),
  email: z.string().email("E-mail inválido"),
  password: z.string().min(8, "A senha precisa ter ao menos 8 caracteres"),
  username: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(1, "Senha obrigatória"),
});

authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { name, email, password } = registerSchema.parse(req.body);

    const exists = await User.findOne({ email });
    if (exists) {
      throw new HttpError(409, "Já existe uma conta com este e-mail");
    }

    let username: string | undefined;
    if (req.body.username != null && String(req.body.username).trim() !== "") {
      const norm = normalizeUsername(String(req.body.username));
      const parsed = usernameSchema.safeParse(norm);
      if (!parsed.success) {
        throw new HttpError(400, `Nome de usuário inválido: ${parsed.error.issues[0].message}`);
      }
      username = parsed.data;
      const taken = await User.findOne({ username });
      if (taken) throw new HttpError(409, "Esse nome de usuário já está em uso.");
    }

    const user = await User.create({
      name,
      email,
      passwordHash: await hashPassword(password),
      ...(username ? { username } : {}),
    });

    const token = signToken(user._id.toString());
    res.status(201).json({ token, user: publicUser(user) });
  })
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const user = await User.findOne({ email });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new HttpError(401, "E-mail ou senha inválidos");
    }

    const token = signToken(user._id.toString());
    res.json({ token, user: publicUser(user) });
  })
);

// Retorna o usuário autenticado (útil pro app checar sessão/onboarding).
authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: publicUser(req.user!) });
  })
);

authRouter.get(
  "/check-username",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = usernameSchema.safeParse(normalizeUsername(String(req.query.username ?? "")));
    if (!parsed.success) return res.json({ available: false });
    const existing = await User.findOne({ username: parsed.data });
    const available = !existing || existing._id.toString() === req.user!._id.toString();
    res.json({ available });
  })
);

const patchMeSchema = z.object({
  name: z.string().min(2, "Nome muito curto").max(80).optional(),
  bio: z.string().max(160, "Bio muito longa").optional(),
  avatarUrl: z.string().max(500).optional(),
  username: usernameSchema.optional(),
});

authRouter.patch(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = patchMeSchema.parse(
      req.body?.username !== undefined
        ? { ...req.body, username: normalizeUsername(String(req.body.username)) }
        : req.body
    );
    const user = req.user!;

    if (body.username !== undefined && body.username !== user.username) {
      const taken = await User.findOne({ username: body.username });
      if (taken) throw new HttpError(409, "Esse nome de usuário já está em uso.");
      user.username = body.username;
    }
    if (body.name !== undefined) user.name = body.name;
    if (body.bio !== undefined) user.bio = body.bio;
    if (body.avatarUrl !== undefined) user.avatarUrl = body.avatarUrl;

    await user.save();
    res.json({ user: publicUser(user) });
  })
);
