import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";

const app = createApp();
let mongod: MongoMemoryServer;
let token = "";
const DATE = "2026-02-10";

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const reg = await request(app).post("/auth/register").send({ name: "Asafe", email: "a@test.com", password: "senha12345" });
  token = reg.body.token;
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);

describe("Água", () => {
  let logId = "";

  it("dia vazio traz meta sugerida (sem custom)", async () => {
    const res = await auth(request(app).get(`/water/day?date=${DATE}`));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.goalMl).toBeGreaterThanOrEqual(1500);
    expect(res.body.goalIsCustom).toBe(false);
  });

  it("registra ingestões e soma o total", async () => {
    await auth(request(app).post("/water/logs").send({ date: DATE, ml: 250 }));
    const r2 = await auth(request(app).post("/water/logs").send({ date: DATE, ml: 500 }));
    expect(r2.status).toBe(201);
    logId = r2.body.data.id;

    const day = await auth(request(app).get(`/water/day?date=${DATE}`));
    expect(day.body.total).toBe(750);
    expect(day.body.logs).toHaveLength(2);
  });

  it("define meta custom e reflete no dia", async () => {
    const g = await auth(request(app).put("/water/goal").send({ goalMl: 3000 }));
    expect(g.status).toBe(200);
    const day = await auth(request(app).get(`/water/day?date=${DATE}`));
    expect(day.body.goalMl).toBe(3000);
    expect(day.body.goalIsCustom).toBe(true);
  });

  it("remove um registro", async () => {
    const del = await auth(request(app).delete(`/water/logs/${logId}`));
    expect(del.status).toBe(200);
    const day = await auth(request(app).get(`/water/day?date=${DATE}`));
    expect(day.body.total).toBe(250);
  });

  it("rejeita ml inválido", async () => {
    const res = await auth(request(app).post("/water/logs").send({ date: DATE, ml: 0 }));
    expect(res.status).toBe(400);
  });
});
