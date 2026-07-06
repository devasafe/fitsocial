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

  it("cadastra com username e rejeita username duplicado", async () => {
    const a = await request(app).post("/auth/register").send({ name: "Ana", email: "ana@test.com", password: "senha12345", username: "ana" });
    expect(a.status).toBe(201);
    expect(a.body.user.username).toBe("ana");

    const b = await request(app).post("/auth/register").send({ name: "Ana2", email: "ana2@test.com", password: "senha12345", username: "ANA" });
    expect(b.status).toBe(409);
  });

  it("cadastra sem username (fica para o gate)", async () => {
    const res = await request(app).post("/auth/register").send({ name: "Sem", email: "sem@test.com", password: "senha12345" });
    expect(res.status).toBe(201);
    expect(res.body.user.username).toBeNull();
  });

  it("GET /auth/check-username: livre, tomado por outro, e o próprio contam certo", async () => {
    const reg = await request(app).post("/auth/register").send({ name: "Chk", email: "chk@test.com", password: "senha12345", username: "chkuser" });
    const token = reg.body.token;
    // outro usuário ocupa "ocupado"
    await request(app).post("/auth/register").send({ name: "Occ", email: "occ@test.com", password: "senha12345", username: "ocupado" });

    const own = await request(app).get("/auth/check-username?username=chkuser").set("Authorization", `Bearer ${token}`);
    expect(own.body.available).toBe(true); // o próprio username conta como disponível

    const taken = await request(app).get("/auth/check-username?username=ocupado").set("Authorization", `Bearer ${token}`);
    expect(taken.body.available).toBe(false); // tomado por outro

    const free = await request(app).get("/auth/check-username?username=livre123").set("Authorization", `Bearer ${token}`);
    expect(free.body.available).toBe(true);
  });

  it("PATCH /auth/me atualiza bio/nome/avatar e troca username", async () => {
    const reg = await request(app).post("/auth/register").send({ name: "Edt", email: "edt@test.com", password: "senha12345", username: "edt" });
    const token = reg.body.token;
    const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);

    const res = await auth(request(app).patch("/auth/me")).send({ name: "Editado", bio: "sou fit", avatarUrl: "http://x/a.jpg", username: "novoedt" });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe("Editado");
    expect(res.body.user.bio).toBe("sou fit");
    expect(res.body.user.avatarUrl).toBe("http://x/a.jpg");
    expect(res.body.user.username).toBe("novoedt");

    // trocar para o próprio username atual deve ser permitido
    const same = await auth(request(app).patch("/auth/me")).send({ username: "novoedt" });
    expect(same.status).toBe(200);
  });

  it("PATCH /auth/me rejeita username já usado por outro (409)", async () => {
    await request(app).post("/auth/register").send({ name: "Dono", email: "dono@test.com", password: "senha12345", username: "dono" });
    const reg = await request(app).post("/auth/register").send({ name: "Outro", email: "outro@test.com", password: "senha12345", username: "outro" });
    const token = reg.body.token;
    const res = await request(app).patch("/auth/me").set("Authorization", `Bearer ${token}`).send({ username: "dono" });
    expect(res.status).toBe(409);
  });
});
