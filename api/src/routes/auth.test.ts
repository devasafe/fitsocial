import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";

const app = createApp();

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("Auth", () => {
  const creds = { name: "Asafe", email: "asafe@test.com", password: "senha12345" };

  it("cadastra um novo usuário e retorna token", async () => {
    const res = await request(app).post("/auth/register").send(creds);
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe(creds.email);
    expect(res.body.user.tier).toBe("free");
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("recusa cadastro com e-mail duplicado", async () => {
    const res = await request(app).post("/auth/register").send(creds);
    expect(res.status).toBe(409);
  });

  it("recusa senha curta", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ name: "X", email: "x@test.com", password: "123" });
    expect(res.status).toBe(400);
  });

  it("faz login com credenciais corretas", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: creds.email, password: creds.password });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it("recusa login com senha errada", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: creds.email, password: "errada" });
    expect(res.status).toBe(401);
  });

  it("retorna o usuário autenticado em /auth/me", async () => {
    const login = await request(app)
      .post("/auth/login")
      .send({ email: creds.email, password: creds.password });
    const token = login.body.token as string;

    const me = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(creds.email);
  });

  it("bloqueia /auth/me sem token", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });
});
