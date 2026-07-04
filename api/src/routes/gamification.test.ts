import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";

const app = createApp();
let mongod: MongoMemoryServer;
let ana = { token: "", id: "" };
let bruno = { token: "", id: "" };

async function reg(name: string, email: string) {
  const r = await request(app).post("/auth/register").send({ name, email, password: "senha12345" });
  return { token: r.body.token as string, id: r.body.user.id as string };
}
const bearer = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  ana = await reg("Ana", "ana@test.com");
  bruno = await reg("Bruno", "bruno@test.com");
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

async function checkin(token: string, day: string) {
  return request(app)
    .post("/checkins")
    .set("Authorization", `Bearer ${token}`)
    .send({ sessionDay: day, entries: [{ exerciseName: "Supino", weightKg: 40, reps: 10 }] });
}

describe("Gamificação", () => {
  it("usuário novo tem todas as badges bloqueadas", async () => {
    const res = await bearer(ana.token)(request(app).get(`/gamification/users/${ana.id}`));
    expect(res.status).toBe(200);
    expect(res.body.badges.every((b: any) => b.earned === false)).toBe(true);
  });

  it("conquista 'primeiro_treino' após um check-in", async () => {
    await checkin(ana.token, "Dia A");
    const res = await bearer(ana.token)(request(app).get(`/gamification/users/${ana.id}`));
    const badge = res.body.badges.find((b: any) => b.id === "primeiro_treino");
    expect(badge.earned).toBe(true);
  });

  it("conquista 'primeiro_post' após postar", async () => {
    await bearer(ana.token)(request(app).post("/social/posts").send({ text: "Bora!" }));
    const res = await bearer(ana.token)(request(app).get(`/gamification/users/${ana.id}`));
    const badge = res.body.badges.find((b: any) => b.id === "primeiro_post");
    expect(badge.earned).toBe(true);
  });

  it("ranking entre seguidos ordena por treinos na semana", async () => {
    // Ana segue Bruno; Bruno treina 2x, Ana já treinou 1x.
    await bearer(ana.token)(request(app).post(`/social/users/${bruno.id}/follow`));
    await checkin(bruno.token, "Dia A");
    await checkin(bruno.token, "Dia B");

    const res = await bearer(ana.token)(request(app).get("/gamification/leaderboard"));
    expect(res.status).toBe(200);
    const board = res.body.leaderboard;
    // Bruno (2) deve vir antes da Ana (1).
    expect(board[0].name).toBe("Bruno");
    expect(board[0].week).toBe(2);
    const anaRow = board.find((r: any) => r.userId === ana.id);
    expect(anaRow.isMe).toBe(true);
  });
});
