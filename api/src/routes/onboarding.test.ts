import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { Profile } from "../models/Profile.js";

const app = createApp();
let mongod: MongoMemoryServer;
let token: string;

const fullProfile = {
  goal: "ganhar_massa",
  sex: "masculino",
  age: 25,
  heightCm: 178,
  weightKg: 74,
  experienceLevel: "iniciante",
  daysPerWeek: 4,
  sessionMinutes: 60,
  dietaryRestrictions: [],
  injuriesConditions: [],
  notes: "",
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const reg = await request(app)
    .post("/auth/register")
    .send({ name: "Asafe", email: "asafe@test.com", password: "senha12345" });
  token = reg.body.token;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("Onboarding (formulário)", () => {
  it("exige autenticação", async () => {
    const res = await request(app).post("/onboarding/profile").send(fullProfile);
    expect(res.status).toBe(401);
  });

  it("cadastra a ficha por formulário e conclui o onboarding", async () => {
    const res = await request(app)
      .post("/onboarding/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...fullProfile, goal: "perder_gordura" });
    expect(res.status).toBe(200);
    expect(res.body.onboardingComplete).toBe(true);

    const profile = await Profile.findOne();
    expect(profile?.goal).toBe("perder_gordura");
    expect(profile?.experienceLevel).toBe("iniciante");

    const me = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    expect(me.body.user.onboardingComplete).toBe(true);
  });

  it("ficha inválida (faltam campos) retorna 400", async () => {
    const reg = await request(app)
      .post("/auth/register")
      .send({ name: "Bruno", email: "b@test.com", password: "senha12345" });
    const t2 = reg.body.token as string;
    const res = await request(app)
      .post("/onboarding/profile")
      .set("Authorization", `Bearer ${t2}`)
      .send({ goal: "ganhar_massa", age: 25 });
    expect(res.status).toBe(400);
  });
});
