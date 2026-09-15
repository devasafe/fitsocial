// Espelho de `gatesDoPlano`/`planoPorDiaDaSemana` para o treino, mas sobre a
// dieta: até esta frente o vínculo de nutricionista não tinha função nenhuma,
// e por isso `POST /plans/diet` e companhia ficavam abertos mesmo para quem
// já tinha nutricionista. Agora o vínculo existe de verdade, e a dieta que
// troca sozinha é a pessoa descobrir de manhã que está comendo outra coisa.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { setAIProvider } from "../services/ai/index.js";
import { User } from "../models/User.js";
import { Profile } from "../models/Profile.js";
import { Plan } from "../models/Plan.js";
import { Activity } from "../models/Activity.js";
import { ProfessionalLink } from "../models/ProfessionalLink.js";
import { ProfessionalInvite } from "../models/ProfessionalInvite.js";
import { CoachMessage } from "../models/CoachMessage.js";
import { FoodLog } from "../models/FoodLog.js";
import type { AIProvider, GenerateOptions } from "../services/ai/provider.js";

const app = createApp();
let mongod: MongoMemoryServer;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const DIETA_GERADA = JSON.stringify({
  summary: "Dieta de teste",
  diet: {
    dailyCalories: 2000,
    macros: { proteinG: 150, carbsG: 200, fatG: 60 },
    meals: [{ name: "Café", timeHint: "07:00", items: [{ food: "Ovos", quantity: "3" }] }],
    notes: "",
  },
  disclaimer: "Aviso.",
});

/** Dublê de IA: só a rota de geração de dieta fala com ela neste arquivo. */
class EspiaoDeProvider implements AIProvider {
  readonly name = "espiao";
  readonly aceitaImagem = false;
  proximaResposta = DIETA_GERADA;
  async generate(_params: GenerateOptions): Promise<string> {
    return this.proximaResposta;
  }
}
const espiao = new EspiaoDeProvider();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  setAIProvider(espiao);
});

afterAll(async () => {
  setAIProvider(null);
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Profile.deleteMany({}),
    Plan.deleteMany({}),
    Activity.deleteMany({}),
    ProfessionalLink.deleteMany({}),
    ProfessionalInvite.deleteMany({}),
    CoachMessage.deleteMany({}),
    FoodLog.deleteMany({}),
  ]);
  espiao.proximaResposta = DIETA_GERADA;
});

let n = 0;
async function registrar(premium = true): Promise<{ token: string; id: mongoose.Types.ObjectId }> {
  n += 1;
  const r = await request(app)
    .post("/auth/register")
    .send({ name: `Pessoa ${n}`, email: `trava${n}@teste.com`, password: "senha-bem-longa" });
  const id = new mongoose.Types.ObjectId(r.body.user.id as string);
  if (premium) {
    await User.updateOne({ _id: id }, { $set: { tier: "premium", premiumSource: "admin" } });
  }
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
    dietaryRestrictions: [],
    injuriesConditions: [],
  });
  return { token: r.body.token as string, id };
}

async function registrarNutri() {
  const p = await registrar();
  await User.updateOne(
    { _id: p.id },
    { $set: { "pro.nutri": { ativo: true, origem: "manual", limiteDeAlunos: 10 } } }
  );
  return p;
}

async function vincular(nutriToken: string, alunoToken: string, papel: "coach" | "nutri" = "nutri") {
  const c = await request(app)
    .post("/pro/convites")
    .set(auth(nutriToken))
    .send({ papel });
  expect(c.status).toBe(201);
  const r = await request(app)
    .post(`/pro/convites/${c.body.data.code}/aceitar`)
    .set(auth(alunoToken))
    .send({});
  expect(r.status).toBe(201);
}

const DIETA_VALIDA = {
  dailyCalories: 2200,
  macros: { proteinG: 150, carbsG: 220, fatG: 70 },
  meals: [{ name: "Almoço", timeHint: "12:00", items: [{ food: "Arroz", quantity: "100g" }] }],
  notes: "",
};

const TREINO_VALIDO = {
  split: "Full body 3x",
  daysPerWeek: 3,
  sessions: [
    { day: "A", focus: "Geral", exercises: [{ name: "Agachamento", sets: 3, reps: "10", restSeconds: 60, notes: "" }] },
  ],
};

function criarPlano(user: mongoose.Types.ObjectId, partes: { workout?: unknown; diet?: unknown; createdBy?: mongoose.Types.ObjectId }) {
  return Plan.create({
    user,
    version: 1,
    summary: "estratégia",
    workout: partes.workout ?? null,
    diet: partes.diet ?? null,
    createdBy: partes.createdBy ?? null,
    disclaimer: "Aviso.",
  });
}

describe("Quem tem nutricionista não recebe dieta da IA", () => {
  it("POST /plans/diet recusa com 409 e manda falar com o profissional", async () => {
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token);

    const r = await request(app).post("/plans/diet").set(auth(aluno.token)).send({}).expect(409);
    expect(r.body.error).toMatch(/nutricionista/i);
    expect(r.body.error).toMatch(/acompanhamento/i);
  });

  it("PUT /plans/current com dieta recusa", async () => {
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token);
    await criarPlano(aluno.id, { workout: TREINO_VALIDO });

    await request(app)
      .put("/plans/current")
      .set(auth(aluno.token))
      .send({ diet: DIETA_VALIDA })
      .expect(409);
  });

  it("PUT /plans/current só com treino CONTINUA passando", async () => {
    // A trava é sobre comida. Quem tem nutricionista e não tem treinador
    // continua dono do próprio treino.
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token);
    await criarPlano(aluno.id, { workout: TREINO_VALIDO });

    await request(app)
      .put("/plans/current")
      .set(auth(aluno.token))
      .send({ workout: TREINO_VALIDO })
      .expect(200);
  });

  it("aluno SEM nutricionista continua gerando dieta", async () => {
    const aluno = await registrar();

    await request(app).post("/plans/diet").set(auth(aluno.token)).send({}).expect(201);
  });

  it("apagar a dieta é permitido quando ela NÃO tem autor", async () => {
    // Dieta feita pela IA pode ser zerada, senão quem tinha dieta antiga e
    // contratou nutricionista ficaria preso a ela.
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token);
    await criarPlano(aluno.id, { diet: DIETA_VALIDA });

    await request(app).delete("/plans/current/diet").set(auth(aluno.token)).expect(200);
  });

  it("apagar a dieta é recusado quando ela foi prescrita", async () => {
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token);
    await criarPlano(aluno.id, { diet: DIETA_VALIDA });
    await Plan.updateOne({ user: aluno.id }, { $set: { createdBy: nutri.id } });

    await request(app).delete("/plans/current/diet").set(auth(aluno.token)).expect(409);
  });

  it("DELETE /plans/current (tudo) é recusado quando a dieta foi prescrita", async () => {
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token);
    await criarPlano(aluno.id, { diet: DIETA_VALIDA, createdBy: nutri.id });

    await request(app).delete("/plans/current").set(auth(aluno.token)).expect(409);
  });

  it("DELETE /plans/current (tudo) continua permitido quando não há autor", async () => {
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token);
    await criarPlano(aluno.id, { diet: DIETA_VALIDA });

    await request(app).delete("/plans/current").set(auth(aluno.token)).expect(200);
  });

  it("apagar o TREINO continua livre para quem só tem nutricionista", async () => {
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token);
    await criarPlano(aluno.id, { workout: TREINO_VALIDO, diet: DIETA_VALIDA });

    await request(app).delete("/plans/current/workout").set(auth(aluno.token)).expect(200);
  });
});

describe("GET /plans/hoje avisa o app: podeEditarDieta", () => {
  it("sem nutricionista, podeEditarDieta é true", async () => {
    const aluno = await registrar();

    const r = await request(app).get("/plans/hoje").set(auth(aluno.token));
    expect(r.body.meta.podeEditarDieta).toBe(true);
  });

  it("com nutricionista, podeEditarDieta é false — e podeEditarPlano não muda", async () => {
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token);

    const r = await request(app).get("/plans/hoje").set(auth(aluno.token));
    expect(r.body.meta.podeEditarDieta).toBe(false);
    expect(r.body.meta.podeEditarPlano).toBe(true);
  });
});

describe("o chat do coach IA respeita o nutricionista", () => {
  const falar = (t: string, content = "quero mudar a dieta") =>
    request(app).post("/coach/messages").set(auth(t)).send({ content });

  it("quem tem nutricionista não recebe dietAdjustPending, e o coach avisa para falar com ele", async () => {
    const nutri = await registrarNutri();
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token);
    await criarPlano(aluno.id, { workout: TREINO_VALIDO, diet: DIETA_VALIDA });
    espiao.proximaResposta = JSON.stringify({ reply: "vou refazer sua dieta", action: "adjust_diet" });

    const r = await falar(aluno.token).expect(200);

    expect(r.body.dietAdjustPending).toBe(false);
    expect(r.body.reply).toContain("vou refazer sua dieta");
    expect(r.body.reply).toMatch(/nutricionista/i);
  });

  it("sem nutricionista, adjust_diet continua funcionando normalmente", async () => {
    const aluno = await registrar();
    await criarPlano(aluno.id, { workout: TREINO_VALIDO, diet: DIETA_VALIDA });
    espiao.proximaResposta = JSON.stringify({ reply: "vou refazer sua dieta", action: "adjust_diet" });

    const r = await falar(aluno.token).expect(200);

    expect(r.body.dietAdjustPending).toBe(true);
    expect(r.body.reply).toBe("vou refazer sua dieta");
  });
});
