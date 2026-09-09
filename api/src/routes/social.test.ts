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

async function registerUser(name: string, email: string, username?: string) {
  const res = await request(app)
    .post("/auth/register")
    .send({ name, email, password: "senha12345", ...(username ? { username } : {}) });
  return { token: res.body.token as string, id: res.body.user.id as string };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ana = await registerUser("Ana", "ana@test.com", "ana");
  bruno = await registerUser("Bruno", "bruno@test.com", "bruno");
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

  it("Ana comenta no post do Bruno e a contagem sobe", async () => {
    const res = await request(app)
      .post(`/social/posts/${brunoPostId}/comments`)
      .set("Authorization", `Bearer ${ana.token}`)
      .send({ text: "Arrasou! 🔥" });
    expect(res.status).toBe(201);
    expect(res.body.comment.text).toBe("Arrasou! 🔥");
    expect(res.body.comment.author.name).toBe("Ana");

    const feed = await request(app)
      .get("/social/feed")
      .set("Authorization", `Bearer ${ana.token}`);
    const post = feed.body.posts.find((p: any) => p.id === brunoPostId);
    expect(post.commentCount).toBe(1);
  });

  it("lista os comentários do post", async () => {
    const res = await request(app)
      .get(`/social/posts/${brunoPostId}/comments`)
      .set("Authorization", `Bearer ${ana.token}`);
    expect(res.status).toBe(200);
    expect(res.body.comments.length).toBe(1);
    expect(res.body.comments[0].text).toBe("Arrasou! 🔥");
  });

  it("comentário vazio é rejeitado (400)", async () => {
    const res = await request(app)
      .post(`/social/posts/${brunoPostId}/comments`)
      .set("Authorization", `Bearer ${ana.token}`)
      .send({ text: "" });
    expect(res.status).toBe(400);
  });

  it("GET /social/posts/:id retorna o post único (deep-link de notificação)", async () => {
    const res = await request(app)
      .get(`/social/posts/${brunoPostId}`)
      .set("Authorization", `Bearer ${ana.token}`);
    expect(res.status).toBe(200);
    expect(res.body.post.id).toBe(brunoPostId);
    expect(res.body.post.author.name).toBe("Bruno");
    expect(typeof res.body.post.likedByMe).toBe("boolean");
  });

  it("GET /social/posts/:id de id inexistente retorna 404", async () => {
    const missing = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .get(`/social/posts/${missing}`)
      .set("Authorization", `Bearer ${ana.token}`);
    expect(res.status).toBe(404);
  });

  it("explore mostra posts de quem você NÃO segue; o feed não", async () => {
    // Carla é uma terceira pessoa que a Ana não segue.
    const carla = await registerUser("Carla", "carla@test.com", "carla");
    const post = await request(app)
      .post("/social/posts")
      .set("Authorization", `Bearer ${carla.token}`)
      .send({ text: "Bora treinar, galera nova! 🚀" });
    const carlaPostId = post.body.post.id as string;

    // Feed da Ana (só quem ela segue) NÃO tem o post da Carla.
    const feed = await request(app).get("/social/feed").set("Authorization", `Bearer ${ana.token}`);
    expect(feed.body.posts.find((p: { id: string }) => p.id === carlaPostId)).toBeUndefined();

    // Explore mostra pra todo mundo.
    const explore = await request(app).get("/social/explore").set("Authorization", `Bearer ${ana.token}`);
    expect(explore.status).toBe(200);
    const found = explore.body.posts.find((p: { id: string }) => p.id === carlaPostId);
    expect(found).toBeTruthy();
    expect(found.author.name).toBe("Carla");
    // Ana não segue a Carla e não é a autora → flags de descoberta corretas.
    expect(found.author.isFollowing).toBe(false);
    expect(found.author.isMe).toBe(false);
  });

  it("WOD compartilhado traz os movimentos no feed", async () => {
    const create = await request(app)
      .post("/activities")
      .set("Authorization", `Bearer ${bruno.token}`)
      .send({
        sportId: "crossfit",
        kind: "wod",
        payload: {
          name: "Cindy",
          scoreType: "amrap",
          level: "rx",
          resultRounds: 20,
          movements: [
            { name: "Pull-ups", reps: 5 },
            { name: "Push-ups", reps: 10 },
            { name: "Air Squats", reps: 15 },
          ],
        },
        shareToFeed: true,
      });
    expect(create.status).toBe(201);

    // Ana segue o Bruno (setup anterior) → vê o post com a atividade populada.
    const feed = await request(app).get("/social/feed").set("Authorization", `Bearer ${ana.token}`);
    const wodPost = feed.body.posts.find((p: { activity?: { kind?: string } }) => p.activity?.kind === "wod");
    expect(wodPost).toBeTruthy();
    expect(wodPost.activity.name).toBe("Cindy");
    expect(wodPost.activity.movements).toHaveLength(3);
    expect(wodPost.activity.movements[0].name).toBe("Pull-ups");
  });

  it("GET /social/search acha por username e por nome, excluindo você", async () => {
    const byUsername = await request(app)
      .get("/social/search?q=brun")
      .set("Authorization", `Bearer ${ana.token}`);
    expect(byUsername.status).toBe(200);
    expect(byUsername.body.users.some((u: { username: string }) => u.username === "bruno")).toBe(true);
    expect(byUsername.body.users.every((u: { id: string }) => u.id !== ana.id)).toBe(true); // não inclui você

    // Ana já segue o Bruno (setup anterior), então isFollowing deve ser true.
    const brunoResult = byUsername.body.users.find((u: { username: string }) => u.username === "bruno");
    expect(brunoResult.isFollowing).toBe(true);

    const byName = await request(app)
      .get("/social/search?q=Bruno")
      .set("Authorization", `Bearer ${ana.token}`);
    expect(byName.body.users.some((u: { username: string }) => u.username === "bruno")).toBe(true);

    const empty = await request(app)
      .get("/social/search?q=")
      .set("Authorization", `Bearer ${ana.token}`);
    expect(empty.body.users).toEqual([]);
  });
});
