import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { Plan } from "../models/Plan.js";

const app = createApp();
let mongod: MongoMemoryServer;
let token = "";
let userId = "";
const DATE = "2026-01-15";

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const reg = await request(app).post("/auth/register").send({ name: "Asafe", email: "a@test.com", password: "senha12345" });
  token = reg.body.token;
  userId = reg.body.user.id;
  await Plan.create({
    user: userId,
    version: 1,
    summary: "s",
    workout: { split: "x", daysPerWeek: 3, sessions: [] },
    diet: { dailyCalories: 2000, macros: { proteinG: 150, carbsG: 200, fatG: 60 }, meals: [], notes: "" },
    disclaimer: "x",
  });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("Nutrição — diário", () => {
  let logId = "";

  it("registra alimentos e o dia soma os totais + traz a meta do plano", async () => {
    await request(app)
      .post("/nutrition/logs")
      .set("Authorization", `Bearer ${token}`)
      .send({ date: DATE, meal: "cafe", name: "Ovos", kcal: 200, proteinG: 18 });
    const r2 = await request(app)
      .post("/nutrition/logs")
      .set("Authorization", `Bearer ${token}`)
      .send({ date: DATE, meal: "almoco", name: "Arroz e frango", kcal: 600, proteinG: 40, carbsG: 70 });
    expect(r2.status).toBe(201);
    logId = r2.body.data.id;

    const day = await request(app).get(`/nutrition/day?date=${DATE}`).set("Authorization", `Bearer ${token}`);
    expect(day.status).toBe(200);
    expect(day.body.logs).toHaveLength(2);
    expect(day.body.totals.kcal).toBe(800);
    expect(day.body.totals.proteinG).toBe(58);
    expect(day.body.target.dailyCalories).toBe(2000);
  });

  it("apaga um registro", async () => {
    const del = await request(app).delete(`/nutrition/logs/${logId}`).set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);
    const day = await request(app).get(`/nutrition/day?date=${DATE}`).set("Authorization", `Bearer ${token}`);
    expect(day.body.logs).toHaveLength(1);
  });
});
