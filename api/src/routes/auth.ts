import { Router } from "express";
import { z } from "zod";
import { User, hashPassword, verifyPassword, publicUser } from "../models/User.js";
import { signToken } from "../utils/token.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().min(2, "Nome muito curto").max(80),
  email: z.string().email("E-mail inválido"),
  password: z.string().min(8, "A senha precisa ter ao menos 8 caracteres"),
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

    const user = await User.create({
      name,
      email,
      passwordHash: await hashPassword(password),
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
