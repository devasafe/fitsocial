import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";

const app = createApp();
let mongod: MongoMemoryServer;
let tokenA = "";
let tokenB = "";
let postId = "";

async function registrar(name: string, email: string): Promise<string> {
  const res = await request(app).post("/auth/register").send({ name, email, password: "senha12345" });
  return res.body.token;
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  tokenA = await registrar("Ana", "a@test.com");
  tokenB = await registrar("Bia", "b@test.com");
  const post = await request(app).post("/social/posts").set("Authorization", `Bearer ${tokenA}`).send({ text: "Bom treino!" });
  postId = post.body.post.id;
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("Notificações", () => {
  it("curtir o post de alguém gera notificação para o autor", async () => {
    await request(app).post(`/social/posts/${postId}/like`).set("Authorization", `Bearer ${tokenB}`);

    const res = await request(app).get("/notifications").set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.unread).toBeGreaterThanOrEqual(1);
    const like = res.body.data.find((n: { type: string }) => n.type === "like");
    expect(like.text).toContain("Bia");
  });

  it("não notifica a si mesmo", async () => {
    const before = (await request(app).get("/notifications").set("Authorization", `Bearer ${tokenB}`)).body.unread;
    await request(app).post(`/social/posts/${postId}/like`).set("Authorization", `Bearer ${tokenB}`); // B já curtiu; no-op
    const after = (await request(app).get("/notifications").set("Authorization", `Bearer ${tokenB}`)).body.unread;
    expect(after).toBe(before);
  });

  it("marcar como lidas zera a contagem", async () => {
    await request(app).post("/notifications/read").set("Authorization", `Bearer ${tokenA}`);
    const res = await request(app).get("/notifications").set("Authorization", `Bearer ${tokenA}`);
    expect(res.body.unread).toBe(0);
  });
});
