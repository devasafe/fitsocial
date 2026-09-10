import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Plan } from "../models/Plan.js";
import { Profile } from "../models/Profile.js";

// A IA é o limite: o que importa provar é que a dieta nasce sozinha, que cada
// metade some sozinha, e que zerar devolve a pessoa à escolha.
vi.mock("../services/ai/planGenerator.js", () => ({
  generatePlan: vi.fn(async () => ({
    summary: "plano completo",
    workout: { split: "ABC", daysPerWeek: 3, sessions: [{ day: "A", focus: "Peito", exercises: [{ name: "Supino", sets: 3, reps: "10", restSeconds: 60, notes: "", kind: "strength" }] }] },
    diet: { dailyCalories: 2200, macros: { proteinG: 150, carbsG: 220, fatG: 70 }, meals: [{ name: "Café", timeHint: "07:00", items: [{ food: "Ovo", quantity: "2 un" }] }], notes: "" },
    disclaimer: "Consulte um profissional.",
  })),
  generateDiet: vi.fn(async () => ({
    summary: "só a dieta",
    diet: { dailyCalories: 2400, macros: { proteinG: 160, carbsG: 250, fatG: 75 }, meals: [{ name: "Almoço", timeHint: "12:00", items: [{ food: "Arroz", quantity: "100g" }] }], notes: "" },
    disclaimer: "Consulte um profissional.",
  })),
  adjustPlan: vi.fn(),
  importPlanFromText: vi.fn(),
}));

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

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Plan.deleteMany({}), Profile.deleteMany({})]);
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let n = 0;
async function registrar() {
  n += 1;
  const r = await request(app)
    .post("/auth/register")
    .send({ name: `Pessoa ${n}`, email: `p${n}@teste.com`, password: "senha-bem-longa" });
  const id = new mongoose.Types.ObjectId(r.body.user.id as string);
  await Profile.create({
    user: id,
    goal: "ganhar_massa",
    sex: "masculino",
    age: 30,
    heightCm: 180,
    weightKg: 80,
    experienceLevel: "intermediario",
    daysPerWeek: 4,
    sessionMinutes: 60,
  });
  return { token: r.body.token as string, id };
}

const gerarPlano = (t: string) => request(app).post("/plans/generate").set(auth(t));
const gerarDieta = (t: string) => request(app).post("/plans/diet").set(auth(t));
const atual = (t: string) => request(app).get("/plans/current").set(auth(t));
const programacao = async (id: mongoose.Types.ObjectId) =>
  (await User.findById(id))?.settings?.programacao ?? null;

describe("Dieta sozinha", () => {
  it("nasce sem treino nenhum junto", async () => {
    const u = await registrar();

    const r = await gerarDieta(u.token).expect(201);

    // O ponto: quem segue a programação do box quer a dieta sem carregar um
    // treino gerado que não vai usar.
    expect(r.body.plan.diet.dailyCalories).toBe(2400);
    expect(r.body.plan.workout).toBeNull();
  });

  it("preenche a metade que faltava quando já existe treino", async () => {
    const u = await registrar();
    await gerarPlano(u.token).expect(201);
    await request(app).delete("/plans/current/diet").set(auth(u.token)).expect(200);

    await gerarDieta(u.token).expect(201);

    const r = await atual(u.token);
    expect(r.body.plan.workout.split).toBe("ABC");
    expect(r.body.plan.diet.dailyCalories).toBe(2400);
  });

  it("no plano grátis, gerar dieta depois do treino ainda é a primeira dieta", async () => {
    const u = await registrar();
    await gerarPlano(u.token).expect(201);
    await request(app).delete("/plans/current/diet").set(auth(u.token));

    // O gate é por metade. Contar por plano cobraria duas vezes pela primeira
    // geração de cada coisa.
    await gerarDieta(u.token).expect(201);
    // A segunda dieta, aí sim, é premium.
    await gerarDieta(u.token).expect(402);
  });
});

describe("Zerar", () => {
  it("apaga o plano inteiro e devolve a escolha de como treina", async () => {
    const u = await registrar();
    await request(app).patch("/auth/settings").set(auth(u.token)).send({ programacao: "plano" });
    await gerarPlano(u.token).expect(201);

    await request(app).delete("/plans/current").set(auth(u.token)).expect(200);

    expect((await atual(u.token)).status).toBe(404);
    // Sem isto a Home ficaria sem plano E sem pergunta: uma tela vazia.
    expect(await programacao(u.id)).toBeNull();
  });

  it("zera só o treino e a dieta continua de pé", async () => {
    const u = await registrar();
    await gerarPlano(u.token).expect(201);

    await request(app).delete("/plans/current/workout").set(auth(u.token)).expect(200);

    const r = await atual(u.token);
    expect(r.body.plan.workout).toBeNull();
    expect(r.body.plan.diet.dailyCalories).toBe(2200);
    // Zerar o treino também devolve a escolha — é ela que decide o que a Home
    // mostra no lugar dele.
    expect(await programacao(u.id)).toBeNull();
  });

  it("zerar as duas metades apaga o plano e devolve a escolha", async () => {
    const u = await registrar();
    await gerarPlano(u.token).expect(201);

    await request(app).delete("/plans/current/workout").set(auth(u.token)).expect(200);
    const r = await request(app).delete("/plans/current/diet").set(auth(u.token)).expect(200);

    expect(r.body.meta.vazio).toBe(true);
    expect(await Plan.countDocuments({ user: u.id })).toBe(0);
    expect(await programacao(u.id)).toBeNull();
  });

  it("zerar a dieta não mexe no treino nem na escolha", async () => {
    const u = await registrar();
    await request(app).patch("/auth/settings").set(auth(u.token)).send({ programacao: "plano" });
    await gerarPlano(u.token).expect(201);

    await request(app).delete("/plans/current/diet").set(auth(u.token)).expect(200);

    const r = await atual(u.token);
    expect(r.body.plan.diet).toBeNull();
    expect(r.body.plan.workout.split).toBe("ABC");
    expect(await programacao(u.id)).toBe("plano");
  });

  it("recusa parte inventada e exige autenticação", async () => {
    const u = await registrar();
    await gerarPlano(u.token);
    expect((await request(app).delete("/plans/current/almoco").set(auth(u.token))).status).toBe(400);
    expect((await request(app).delete("/plans/current")).status).toBe(401);
  });
});
