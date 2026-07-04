import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";

const app = createApp();
let mongod: MongoMemoryServer;

// Dois usuários: Ana e Bruno.
let ana = { token: "", id: "" };
let bruno = { token: "", id: "" };

async function registerUser(name: string, email: string) {
  const res = await request(app)
    .post("/auth/register")
    .send({ name, email, password: "senha12345" });
  return { token: res.body.token as string, id: res.body.user.id as string };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ana = await registerUser("Ana", "ana@test.com");
  bruno = await registerUser("Bruno", "bruno@test.com");
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("Rede social", () => {
  let brunoPostId = "";

  it("exige autenticação", async () => {
    const res = await request(app).get("/social/feed");
    expect(res.status).toBe(401);
  });

  it("Bruno cria um post", async () => {
    const res = await request(app)
      .post("/social/posts")
      .set("Authorization", `Bearer ${bruno.token}`)
      .send({ text: "Primeiro treino da semana! 💪" });
    expect(res.status).toBe(201);
    expect(res.body.post.text).toContain("Primeiro treino");
    expect(res.body.post.author.name).toBe("Bruno");
    expect(res.body.post.likeCount).toBe(0);
    brunoPostId = res.body.post.id;
  });

  it("feed da Ana não mostra o post do Bruno antes de seguir", async () => {
    const res = await request(app)
      .get("/social/feed")
      .set("Authorization", `Bearer ${ana.token}`);
    expect(res.status).toBe(200);
    expect(res.body.posts.find((p: any) => p.id === brunoPostId)).toBeUndefined();
  });

  it("Ana segue o Bruno e passa a ver o post no feed", async () => {
    const follow = await request(app)
      .post(`/social/users/${bruno.id}/follow`)
      .set("Authorization", `Bearer ${ana.token}`);
    expect(follow.status).toBe(200);
    expect(follow.body.following).toBe(true);

    const feed = await request(app)
      .get("/social/feed")
      .set("Authorization", `Bearer ${ana.token}`);
    expect(feed.body.posts.some((p: any) => p.id === brunoPostId)).toBe(true);
  });

  it("não deixa seguir a si mesmo", async () => {
    const res = await request(app)
      .post(`/social/users/${ana.id}/follow`)
      .set("Authorization", `Bearer ${ana.token}`);
    expect(res.status).toBe(400);
  });

  it("Ana curte e descurte o post (toggle idempotente)", async () => {
    const like1 = await request(app)
      .post(`/social/posts/${brunoPostId}/like`)
      .set("Authorization", `Bearer ${ana.token}`);
    expect(like1.body).toEqual({ liked: true, likeCount: 1 });

    // Curtir de novo não duplica.
    const like2 = await request(app)
      .post(`/social/posts/${brunoPostId}/like`)
      .set("Authorization", `Bearer ${ana.token}`);
    expect(like2.body.likeCount).toBe(1);

    const unlike = await request(app)
      .delete(`/social/posts/${brunoPostId}/like`)
      .set("Authorization", `Bearer ${ana.token}`);
    expect(unlike.body).toEqual({ liked: false, likeCount: 0 });
  });

  it("perfil do Bruno mostra contagens e isFollowing corretos para a Ana", async () => {
    const res = await request(app)
      .get(`/social/users/${bruno.id}`)
      .set("Authorization", `Bearer ${ana.token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe("Bruno");
    expect(res.body.isFollowing).toBe(true);
    expect(res.body.isMe).toBe(false);
    expect(res.body.counts.followers).toBe(1);
    expect(res.body.counts.posts).toBe(1);
  });

  it("valida corpo do post (texto vazio -> 400)", async () => {
    const res = await request(app)
      .post("/social/posts")
      .set("Authorization", `Bearer ${bruno.token}`)
      .send({ text: "" });
    expect(res.status).toBe(400);
  });

  it("ID inválido retorna 400", async () => {
    const res = await request(app)
      .get("/social/users/nao-e-um-id")
      .set("Authorization", `Bearer ${ana.token}`);
    expect(res.status).toBe(400);
  });
});
