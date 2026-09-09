import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { User } from "../models/User.js";

// A foto de perfil só aparece se o backend mandar a URL junto de cada pessoa.
// Vários endpoints populavam apenas o nome, e o círculo caía no fallback da
// inicial mesmo para quem tinha foto. Estes testes existem para isso não voltar.

const app = createApp();
let mongod: MongoMemoryServer;
const SENHA = "senha-bem-longa";
const FOTO = "https://fitcdn.satriz.club/fotos/perfil.jpg";

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await mongoose.connection.db!.dropDatabase();
});

async function comFoto(email: string) {
  const r = await request(app).post("/auth/register").send({ name: "Fulano", email, password: SENHA });
  await User.updateOne({ _id: r.body.user.id }, { $set: { avatarUrl: FOTO } });
  return { token: r.body.token as string, id: r.body.user.id as string };
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("Foto de perfil nas respostas", () => {
  it("vem no autor do post no feed", async () => {
    const u = await comFoto("autor@teste.com");
    await request(app).post("/social/posts").set(auth(u.token)).send({ text: "treino" });

    const feed = await request(app).get("/social/feed").set(auth(u.token));
    expect(feed.body.posts[0].author.avatarUrl).toBe(FOTO);
  });

  it("vem no autor do comentário", async () => {
    const u = await comFoto("autor@teste.com");
    const post = await request(app).post("/social/posts").set(auth(u.token)).send({ text: "treino" });
    const postId = post.body.post.id;

    const criado = await request(app)
      .post(`/social/posts/${postId}/comments`).set(auth(u.token)).send({ text: "boa!" });
    const lista = await request(app).get(`/social/posts/${postId}/comments`).set(auth(u.token));

    // Tanto na resposta de criação quanto na listagem.
    expect(criado.body.comment.author.avatarUrl).toBe(FOTO);
    expect(lista.body.comments[0].author.avatarUrl).toBe(FOTO);
  });

  it("vem em quem aparece na busca de pessoas", async () => {
    const eu = await comFoto("eu@teste.com");
    await comFoto("procurado@teste.com");

    const busca = await request(app).get("/social/search?q=Fulano").set(auth(eu.token));
    expect(busca.body.users.length).toBeGreaterThan(0);
    expect(busca.body.users[0].avatarUrl).toBe(FOTO);
  });

  it("vem em quem aparece no ranking", async () => {
    const u = await comFoto("competidor@teste.com");

    const rank = await request(app).get("/gamification/leaderboard").set(auth(u.token));
    expect(rank.body.leaderboard[0].avatarUrl).toBe(FOTO);
  });

  it("vem em quem gerou a notificação", async () => {
    const dono = await comFoto("dono@teste.com");
    const outro = await comFoto("outro@teste.com");
    const post = await request(app).post("/social/posts").set(auth(dono.token)).send({ text: "oi" });

    await request(app).post(`/social/posts/${post.body.post.id}/like`).set(auth(outro.token));

    const notif = await request(app).get("/notifications").set(auth(dono.token));
    expect(notif.body.data[0].actor.avatarUrl).toBe(FOTO);
  });

  it("quem não tem foto continua devolvendo string vazia, nunca undefined", async () => {
    const r = await request(app)
      .post("/auth/register").send({ name: "Sem Foto", email: "semfoto@teste.com", password: SENHA });
    const post = await request(app).post("/social/posts").set(auth(r.body.token)).send({ text: "oi" });
    const comentario = await request(app)
      .post(`/social/posts/${post.body.post.id}/comments`).set(auth(r.body.token)).send({ text: "eu mesmo" });

    // O app trata "" como ausência e mostra a inicial; undefined viraria "undefined" na URL.
    expect(comentario.body.comment.author.avatarUrl).toBe("");
  });
});
