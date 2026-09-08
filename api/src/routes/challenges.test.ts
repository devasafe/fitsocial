import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";

const app = createApp();
let mongod: MongoMemoryServer;
let tokenA = "";
let tokenB = "";

async function registrar(email: string): Promise<string> {
  const res = await request(app).post("/auth/register").send({ name: email, email, password: "senha12345" });
  return res.body.token;
}

async function correr(token: string, distanceM: number) {
  await request(app)
    .post("/activities")
    .set("Authorization", `Bearer ${token}`)
    .send({ sportId: "corrida", kind: "endurance", durationSec: 1800, payload: { distanceM } });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  tokenA = await registrar("a@test.com");
  tokenB = await registrar("b@test.com");
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("Desafios", () => {
  let challengeId = "";
  let joinCode = "";

  it("cria um desafio e devolve o código de convite", async () => {
    const res = await request(app)
      .post("/challenges")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        name: "Corrida do mês",
        startAt: new Date(Date.now() - 86_400_000).toISOString(),
        endAt: new Date(Date.now() + 86_400_000).toISOString(),
        scoreMode: "distance",
        sportIds: ["corrida"],
        visibility: "public",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.joinCode).toBeTruthy();
    challengeId = res.body.data.id;
    joinCode = res.body.data.joinCode;
  });

  it("outra pessoa entra pelo código", async () => {
    const res = await request(app).post("/challenges/join").set("Authorization", `Bearer ${tokenB}`).send({ code: joinCode });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(challengeId);
  });

  it("código inválido dá 404", async () => {
    const res = await request(app).post("/challenges/join").set("Authorization", `Bearer ${tokenB}`).send({ code: "XXXXXX" });
    expect(res.status).toBe(404);
  });

  it("ranking pontua pelas atividades no período, ordenado", async () => {
    await correr(tokenA, 5000); // 5 km
    await correr(tokenB, 3000); // 3 km

    const res = await request(app).get(`/challenges/${challengeId}/leaderboard`).set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    const board = res.body.data as { userId: string; score: number; isMe: boolean; position: number }[];
    expect(board).toHaveLength(2);
    expect(board[0].score).toBeCloseTo(5, 1);
    expect(board[0].position).toBe(1);
    expect(board[1].score).toBeCloseTo(3, 1);
    // A é o líder e sou "eu" nesta requisição
    expect(board[0].isMe).toBe(true);
  });

  it("meus desafios lista o desafio para quem participa", async () => {
    const res = await request(app).get("/challenges").set("Authorization", `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body.data.some((c: { id: string }) => c.id === challengeId)).toBe(true);
  });

  it("descobrir lista desafios públicos", async () => {
    const res = await request(app).get("/challenges/discover").set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.data.some((c: { id: string }) => c.id === challengeId)).toBe(true);
  });
});
