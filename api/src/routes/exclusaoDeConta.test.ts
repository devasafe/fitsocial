import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Post } from "../models/Post.js";
import { Comment } from "../models/Comment.js";
import { Like } from "../models/Like.js";
import { Follow } from "../models/Follow.js";
import { Notification } from "../models/Notification.js";
import { Report } from "../models/Report.js";
import { Profile } from "../models/Profile.js";
import { Activity } from "../models/Activity.js";
import { Challenge } from "../models/Challenge.js";
import { ChallengeMember } from "../models/ChallengeMember.js";
import { AdminAudit } from "../models/AdminAudit.js";
import { PushDevice } from "../models/PushDevice.js";
import { setStorageProvider } from "../services/storage/index.js";
import { grantAdmin } from "../scripts/grantAdmin.js";

const app = createApp();
let mongod: MongoMemoryServer;

/** O storage é o limite: o que importa provar é que a foto foi mandada apagar. */
const apagados: string[] = [];

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  setStorageProvider({
    name: "fake",
    save: async () => ({ url: "https://cdn.fake/foto.jpg" }),
    delete: async (url) => {
      apagados.push(url);
    },
  });
});

afterAll(async () => {
  setStorageProvider(null);
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), Post.deleteMany({}), Comment.deleteMany({}), Like.deleteMany({}),
    Follow.deleteMany({}), Notification.deleteMany({}), Report.deleteMany({}),
    Profile.deleteMany({}), Activity.deleteMany({}), Challenge.deleteMany({}),
    ChallengeMember.deleteMany({}), AdminAudit.deleteMany({}), PushDevice.deleteMany({}),
  ]);
  apagados.length = 0;
});

const SENHA = "senha-bem-longa";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let n = 0;
let ipSeq = 0;
const ip = () => `198.18.1.${++ipSeq}`;

async function registrar(nome?: string) {
  n += 1;
  const email = `p${n}@teste.com`;
  const r = await request(app)
    .post("/auth/register")
    .send({ name: nome ?? `Pessoa ${n}`, email, password: SENHA });
  return {
    token: r.body.token as string,
    id: new mongoose.Types.ObjectId(r.body.user.id as string),
    email,
  };
}

const excluir = (token: string, senha = SENHA) =>
  request(app).delete("/auth/me").set(auth(token)).set("X-Forwarded-For", ip()).send({ senha });

const publicar = (token: string, text = "meu treino") =>
  request(app).post("/social/posts").set(auth(token)).send({ text });

function desafio(creator: mongoose.Types.ObjectId) {
  return Challenge.create({
    creator,
    name: "Desafio",
    startAt: new Date(),
    endAt: new Date(Date.now() + 86_400_000),
    joinCode: `C${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    scoreMode: "checkins",
    visibility: "public",
  });
}

describe("Excluir a conta", () => {
  it("apaga a conta e libera o e-mail para um cadastro novo", async () => {
    const eu = await registrar();

    await excluir(eu.token).expect(200);

    expect(await User.countDocuments({ _id: eu.id })).toBe(0);
    // Sem isso, "excluir" seria só bloquear: a pessoa não conseguiria nem
    // voltar com o mesmo e-mail depois.
    const denovo = await request(app)
      .post("/auth/register")
      .send({ name: "Voltei", email: eu.email, password: SENHA });
    expect(denovo.status).toBe(201);
  });

  it("o token para de valer na hora", async () => {
    const eu = await registrar();
    await excluir(eu.token).expect(200);

    expect((await request(app).get("/auth/me").set(auth(eu.token))).status).toBe(401);
  });

  it("leva junto ficha de saúde, treinos, posts, comentários e curtidas", async () => {
    const eu = await registrar();
    const outro = await registrar();
    const meuPost = (await publicar(eu.token)).body.post;
    const postAlheio = (await publicar(outro.token)).body.post;

    await Profile.create({
      user: eu.id,
      goal: "ganhar_massa",
      sex: "masculino",
      age: 30,
      heightCm: 180,
      weightKg: 80,
      experienceLevel: "intermediario",
      daysPerWeek: 4,
      sessionMinutes: 60,
    });
    await Activity.create({ user: eu.id, kind: "strength", sportId: "musculacao", payload: {} });
    await request(app).post(`/social/posts/${postAlheio.id}/like`).set(auth(eu.token));
    await request(app)
      .post(`/social/posts/${postAlheio.id}/comments`)
      .set(auth(eu.token))
      .send({ text: "boa!" });
    await request(app).post(`/push/devices`).set(auth(eu.token))
      .send({ token: "ExpoPushToken[meu-celular]", platform: "android" });

    await excluir(eu.token).expect(200);

    expect(await Profile.countDocuments({ user: eu.id })).toBe(0);
    expect(await Activity.countDocuments({ user: eu.id })).toBe(0);
    expect(await Post.countDocuments({ author: eu.id })).toBe(0);
    expect(await Comment.countDocuments({ author: eu.id })).toBe(0);
    expect(await Like.countDocuments({ user: eu.id })).toBe(0);
    expect(await PushDevice.countDocuments({ user: eu.id })).toBe(0);
    // O post de terceiro continua de pé — não é dela para apagar.
    expect(await Post.countDocuments({ _id: postAlheio.id })).toBe(1);
    expect(meuPost.id).toBeTruthy();
  });

  it("desfaz os laços nos dois sentidos", async () => {
    const eu = await registrar();
    const a = await registrar();
    const b = await registrar();
    await Follow.create({ follower: eu.id, following: a.id });
    await Follow.create({ follower: b.id, following: eu.id });

    await excluir(eu.token).expect(200);

    expect(await Follow.countDocuments({ $or: [{ follower: eu.id }, { following: eu.id }] })).toBe(0);
  });

  it("apaga também as notificações que ela causou em outras pessoas", async () => {
    const dono = await registrar("Dono");
    const eu = await registrar("Ana");
    const post = (await publicar(dono.token)).body.post;
    await request(app).post(`/social/posts/${post.id}/like`).set(auth(eu.token));

    expect(await Notification.countDocuments({ user: dono.id })).toBe(1);

    await excluir(eu.token).expect(200);

    // "Ana curtiu seu post" continuaria nomeando quem pediu para sumir.
    expect(await Notification.countDocuments({ actor: eu.id })).toBe(0);
    expect(await Notification.countDocuments({ user: dono.id })).toBe(0);
  });

  it("manda apagar a foto de perfil no armazenamento", async () => {
    const eu = await registrar();
    await User.updateOne({ _id: eu.id }, { $set: { avatarUrl: "https://cdn.fake/foto.jpg" } });

    await excluir(eu.token).expect(200);

    // Conta apagada com selfie ainda acessível na CDN não é conta apagada.
    expect(apagados).toEqual(["https://cdn.fake/foto.jpg"]);
  });

  it("preserva o desafio que tem outras pessoas dentro", async () => {
    const eu = await registrar();
    const outro = await registrar();
    const d = await desafio(eu.id);
    await ChallengeMember.create({ challenge: d._id, user: eu.id });
    await ChallengeMember.create({ challenge: d._id, user: outro.id });

    const r = await excluir(eu.token).expect(200);

    // Apagar levaria junto o histórico de quem não pediu nada.
    expect(r.body.meta.desafiosPreservados).toBe(1);
    expect(await Challenge.countDocuments({ _id: d._id })).toBe(1);
    expect(await ChallengeMember.countDocuments({ challenge: d._id })).toBe(1);
  });

  it("apaga o desafio em que ela era a única pessoa", async () => {
    const eu = await registrar();
    const d = await desafio(eu.id);
    await ChallengeMember.create({ challenge: d._id, user: eu.id });

    await excluir(eu.token).expect(200);

    expect(await Challenge.countDocuments({ _id: d._id })).toBe(0);
  });

  it("mantém a auditoria do que a moderação fez", async () => {
    const eu = await registrar();
    await AdminAudit.create({
      actor: new mongoose.Types.ObjectId(),
      action: "usuario.baniu",
      targetKind: "user",
      targetId: eu.id,
      targetLabel: "p***@teste.com",
      reason: "spam",
    });

    await excluir(eu.token).expect(200);

    // Se sumisse, um admin poderia encobrir a própria ação excluindo a conta
    // que ele olhou.
    expect(await AdminAudit.countDocuments({ targetId: eu.id })).toBe(1);
  });

  it("recusa senha errada", async () => {
    const eu = await registrar();

    const r = await excluir(eu.token, "chute-errado-longo");

    expect(r.status).toBe(400);
    expect(await User.countDocuments({ _id: eu.id })).toBe(1);
  });

  it("não deixa administrador se autoexcluir", async () => {
    n += 1;
    const email = `adm${n}@teste.com`;
    const r = await request(app)
      .post("/auth/register")
      .send({ name: "Chefe da Casa", email, password: SENHA });
    await grantAdmin(email, { force: true });

    const tentativa = await excluir(r.body.token as string);

    // Sair sozinho deixaria o painel sem dono e levaria embora a trilha de
    // responsabilidade dele.
    expect(tentativa.status).toBe(403);
    expect(await User.countDocuments({ email })).toBe(1);
  });

  it("exige autenticação e senha", async () => {
    const eu = await registrar();
    expect((await request(app).delete("/auth/me").send({ senha: SENHA })).status).toBe(401);
    expect(
      (await request(app).delete("/auth/me").set(auth(eu.token)).set("X-Forwarded-For", ip()).send({}))
        .status
    ).toBe(400);
  });
});
