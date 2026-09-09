import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";

// Fundadores são lidos do env ao vivo — configura antes das requisições.
process.env.FOUNDER_EMAILS = "amigo@test.com, outro@test.com";
process.env.FOUNDER_MESSAGE = "Bem-vindo, lenda!";

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

describe("Fundadores (premium de presente)", () => {
  it("e-mail na lista entra premium com a mensagem", async () => {
    const reg = await request(app)
      .post("/auth/register")
      .send({ name: "Amigo", email: "amigo@test.com", password: "senha12345" });
    expect(reg.status).toBe(201);
    expect(reg.body.user.tier).toBe("premium");
    expect(reg.body.user.isFounder).toBe(true);
    expect(reg.body.user.founderMessage).toBe("Bem-vindo, lenda!");

    // Persistiu: o /me também reflete.
    const me = await request(app).get("/auth/me").set("Authorization", `Bearer ${reg.body.token}`);
    expect(me.body.user.tier).toBe("premium");
    expect(me.body.user.isFounder).toBe(true);
  });

  it("e-mail fora da lista continua free, sem mensagem", async () => {
    const reg = await request(app)
      .post("/auth/register")
      .send({ name: "Zé", email: "ze@test.com", password: "senha12345" });
    expect(reg.status).toBe(201);
    expect(reg.body.user.tier).toBe("free");
    expect(reg.body.user.isFounder).toBe(false);
    expect(reg.body.user.founderMessage).toBeNull();
  });

  it("fundador que já existia vira premium ao logar", async () => {
    // Cadastra 'outro' e força free no banco (simula conta anterior à feature).
    const reg = await request(app)
      .post("/auth/register")
      .send({ name: "Outro", email: "outro@test.com", password: "senha12345" });
    await mongoose.connection.collection("users").updateOne(
      { email: "outro@test.com" },
      { $set: { tier: "free" } }
    );

    const login = await request(app)
      .post("/auth/login")
      .send({ email: "outro@test.com", password: "senha12345" });
    expect(login.status).toBe(200);
    expect(login.body.user.tier).toBe("premium");
    expect(reg.body.user.email).toBe("outro@test.com");
  });
});
