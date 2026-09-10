import { Router } from "express";
import { z } from "zod";
import { User, hashPassword, verifyPassword, publicUser, type UserDoc } from "../models/User.js";
import { signToken } from "../utils/token.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { excluirConta } from "../services/accountDeletion.js";
import { pedirRedefinicao, redefinirSenha } from "../services/passwordReset.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { usernameSchema, normalizeUsername } from "../utils/username.js";
import { isFounder, founderMessage, ensureFounderPremium } from "../services/founders.js";
import { assertAccountUsable } from "../services/moderation.js";

export const authRouter = Router();

// Resposta do usuário + flags de fundador (mensagem só para eles).
function userPayload(user: UserDoc) {
  const founder = isFounder(user.email);
  return { ...publicUser(user), isFounder: founder, founderMessage: founder ? founderMessage() : null };
}

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

    await ensureFounderPremium(user); // amigo fundador já entra premium
    const token = signToken(user._id.toString());
    res.status(201).json({ token, user: userPayload(user) });
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

    // O login não passa por requireAuth (é ele que cria o token), então a
    // checagem de conta banida/suspensa precisa acontecer aqui também. Sem
    // isto, a pessoa entra no app e só descobre o bloqueio quando tudo falha.
    await assertAccountUsable(user);

    await ensureFounderPremium(user);
    const token = signToken(user._id.toString(), { tokenVersion: user.tokenVersion ?? 0 });
    res.json({ token, user: userPayload(user) });
  })
);

// Retorna o usuário autenticado (útil pro app checar sessão/onboarding).
authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    await ensureFounderPremium(req.user!);
    res.json({ user: userPayload(req.user!) });
  })
);

// Trocar a senha.
const senhaSchema = z.object({
  atual: z.string().min(1, "Informe a senha atual"),
  nova: z.string().min(8, "A nova senha precisa ter ao menos 8 caracteres"),
});

authRouter.patch(
  "/password",
  requireAuth,
  rateLimit({ windowMs: 15 * 60_000, max: 5, name: "troca-senha" }),
  asyncHandler(async (req, res) => {
    const { atual, nova } = senhaSchema.parse(req.body);
    const user = req.user!;

    if (!(await verifyPassword(atual, user.passwordHash))) {
      throw new HttpError(400, "A senha atual não confere.");
    }
    if (atual === nova) {
      throw new HttpError(400, "A nova senha precisa ser diferente da atual.");
    }

    user.passwordHash = await hashPassword(nova);
    // Derruba as sessões antigas: se alguém entrou na conta, trocar a senha
    // tem que expulsar essa pessoa — senão a troca não protege de nada.
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await user.save();

    // E devolve um token novo, para quem trocou não ser deslogado junto.
    const token = signToken(user._id.toString(), { tokenVersion: user.tokenVersion });

    res.json({
      data: { token },
      meta: { sessoesEncerradas: true },
    });
  })
);

const esqueciSchema = z.object({ email: z.string().email("E-mail inválido") });

/**
 * Pede um código para criar uma senha nova.
 *
 * Responde SEMPRE a mesma coisa, exista o e-mail ou não. Uma rota que responde
 * "não encontrei" para um e-mail e "enviamos" para outro é uma lista de quem
 * tem conta aqui, servida a quem perguntar — e serve de graça para quem monta
 * lista de alvo.
 */
authRouter.post(
  "/forgot-password",
  rateLimit({ windowMs: 15 * 60_000, max: 5, name: "esqueci-senha" }),
  asyncHandler(async (req, res) => {
    const { email } = esqueciSchema.parse(req.body);
    await pedirRedefinicao(email);
    res.json({
      data: { enviado: true },
      meta: { mensagem: "Se este e-mail tiver conta, o código chega em instantes." },
    });
  })
);

const redefinirSchema = z.object({
  email: z.string().email("E-mail inválido"),
  codigo: z.string().regex(/^\d{6}$/, "O código tem 6 dígitos"),
  nova: z.string().min(8, "A senha precisa de pelo menos 8 caracteres").max(200),
});

/** Conclui a redefinição e já devolve a pessoa logada, com sessão nova. */
authRouter.post(
  "/reset-password",
  rateLimit({ windowMs: 15 * 60_000, max: 10, name: "redefinir-senha" }),
  asyncHandler(async (req, res) => {
    const { email, codigo, nova } = redefinirSchema.parse(req.body);
    const user = await redefinirSenha(email, codigo, nova);

    const token = signToken(user._id.toString(), { tokenVersion: user.tokenVersion });
    res.json({ data: { token, user: publicUser(user) }, meta: { sessoesEncerradas: true } });
  })
);

/**
 * Exclusão de conta a pedido da pessoa (LGPD, art. 18, VI).
 *
 * Pede a senha porque é irreversível e porque um token roubado não pode
 * apagar a vida de alguém. Não existe "desativar": o que a pessoa está
 * pedindo é que o tratamento dos dados acabe, e conta desativada continua
 * sendo tratamento.
 */
authRouter.delete(
  "/me",
  requireAuth,
  rateLimit({ windowMs: 15 * 60_000, max: 5, name: "exclusao-conta" }),
  asyncHandler(async (req, res) => {
    const { senha } = z
      .object({ senha: z.string().min(1, "Confirme sua senha") })
      .parse(req.body);
    const user = req.user!;

    if (!(await verifyPassword(senha, user.passwordHash))) {
      throw new HttpError(400, "A senha não confere.");
    }

    const resumo = await excluirConta(user);
    res.json({ data: { excluida: true }, meta: resumo });
  })
);

// Preferências de privacidade. Separadas de PATCH /me (que é identidade:
// nome, foto, bio) porque mudam quem enxerga o quê, não quem a pessoa é.
const settingsSchema = z.object({
  activitiesPublic: z.boolean().nullable().optional(),
  routesPublic: z.boolean().optional(),
  notificacoes: z
    .object({
      novosPosts: z.boolean().optional(),
      interacoes: z.boolean().optional(),
      desafios: z.boolean().optional(),
      sistema: z.boolean().optional(),
    })
    .optional(),
});

/** Forma única das preferências, para leitura e escrita devolverem o mesmo. */
function preferencias(u: UserDoc) {
  const s = (u.settings ?? {}) as {
    activitiesPublic?: boolean | null;
    routesPublic?: boolean;
    notificacoes?: Partial<Record<string, boolean>> | null;
  };
  return {
    activitiesPublic: s.activitiesPublic ?? null,
    routesPublic: s.routesPublic ?? false,
    notificacoes: {
      novosPosts: s.notificacoes?.novosPosts ?? true,
      interacoes: s.notificacoes?.interacoes ?? true,
      desafios: s.notificacoes?.desafios ?? true,
      sistema: s.notificacoes?.sistema ?? true,
    },
  };
}

authRouter.get(
  "/settings",
  requireAuth,
  asyncHandler(async (req, res) => {
    // activitiesPublic null = a pessoa ainda não decidiu; é o que faz o app
    // perguntar depois do primeiro treino.
    res.json({ data: preferencias(req.user!), meta: {} });
  })
);

authRouter.patch(
  "/settings",
  requireAuth,
  asyncHandler(async (req, res) => {
    const entrada = settingsSchema.parse(req.body);
    const user = req.user!;

    if (entrada.activitiesPublic !== undefined) {
      user.set("settings.activitiesPublic", entrada.activitiesPublic);
    }
    if (entrada.routesPublic !== undefined) {
      user.set("settings.routesPublic", entrada.routesPublic);
    }
    for (const [chave, valor] of Object.entries(entrada.notificacoes ?? {})) {
      if (valor !== undefined) user.set(`settings.notificacoes.${chave}`, valor);
    }
    await user.save();

    res.json({ data: preferencias(user), meta: {} });
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
    res.json({ user: userPayload(user) });
  })
);
