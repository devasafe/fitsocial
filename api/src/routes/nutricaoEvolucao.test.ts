import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { FoodLog } from "../models/FoodLog.js";
import { User } from "../models/User.js";
import { chaveDoDia } from "../utils/dia.js";

const app = createApp();
let mongod: MongoMemoryServer;
let token = "";
let userId = "";

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const reg = await request(app)
    .post("/auth/register")
    .send({ name: "Asafe", email: "nutri@test.com", password: "senha12345" });
  token = reg.body.token;
  userId = reg.body.user.id;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await FoodLog.deleteMany({});
  // O gate de janela olha o plano: premium por padrão, e o teste do grátis
  // rebaixa explicitamente.
  await User.updateOne({ _id: userId }, { $set: { plan: "pro", tier: "premium" } });
});

const pedir = (qs = "") =>
  request(app).get(`/nutrition/evolucao${qs}`).set("Authorization", `Bearer ${token}`);

describe("GET /nutrition/evolucao", () => {
  it("exige autenticacao", async () => {
    await request(app).get("/nutrition/evolucao").expect(401);
  });

  it("devolve a janela inteira, com envelope", async () => {
    const r = await pedir("?dias=30").expect(200);

    expect(r.body.data.dias).toHaveLength(30);
    expect(r.body.meta).toEqual({ dias: 30 });
    expect(r.body.data.resumo.diasNaJanela).toBe(30);
  });

  it("o dia sem registro chega no app como null", async () => {
    const r = await pedir("?dias=7").expect(200);
    expect(r.body.data.dias[0].kcal).toBeNull();
  });

  it("soma o que foi registrado hoje", async () => {
    await FoodLog.create({
      user: new mongoose.Types.ObjectId(userId), date: chaveDoDia(), meal: "janta",
      name: "feijoada", kcal: 700, proteinG: 40, carbsG: 50, fatG: 30,
    });

    const r = await pedir("?dias=7").expect(200);
    const hoje = r.body.data.dias.at(-1);

    expect(hoje.kcal).toBe(700);
    expect(hoje.registros).toBe(1);
  });

  it("o gratis tem a janela cortada, e o corpo diz que cortou", async () => {
    await User.updateOne({ _id: userId }, { $set: { plan: "free", tier: "free" } });

    const r = await pedir("?dias=90").expect(200);

    // Cortado, e nao recusado: um 402 mandaria o APK instalado para a tela de
    // assinatura a partir de um grafico.
    expect(r.body.data.dias).toHaveLength(7);
    expect(r.body.meta).toEqual({ dias: 7, diasPedidos: 90, limitadoPor: "plano" });
  });

  it("janela vazia ou absurda nao vira varredura", async () => {
    await pedir("?dias=").expect(200);
    await pedir("?dias=99999").expect(400);
  });
});
