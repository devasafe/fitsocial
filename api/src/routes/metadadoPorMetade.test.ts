// `Plan` guardava UM `createdBy`, UMA `createdAt` e UM `disclaimer` para as
// DUAS metades (`workout` e `diet`) — toda pergunta sobre uma metade era
// respondida pelo documento inteiro, e mentia sempre que as metades tinham
// donos diferentes. Ver
// `docs/superpowers/specs/2026-09-17-metadado-por-metade-do-plano-design.md`.
//
// Este arquivo prova, um teste por sintoma do desenho, que os seis campos
// novos (`workoutCreatedBy`/`workoutEm`/`workoutDisclaimer`,
// `dietCreatedBy`/`dietEm`/`dietDisclaimer`) resolvem cada mentira sem tocar
// no que o APK 1.2.0 instalado ainda lê (`createdBy`/`disclaimer`).

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Profile } from "../models/Profile.js";
import { Plan } from "../models/Plan.js";
import { ProfessionalLink } from "../models/ProfessionalLink.js";
import { ProfessionalInvite } from "../models/ProfessionalInvite.js";
import { ProMessage } from "../models/ProMessage.js";
import { setAIProvider } from "../services/ai/index.js";
import type { AIProvider, GenerateOptions } from "../services/ai/provider.js";

const app = createApp();
let mongod: MongoMemoryServer;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// `planDataSchema` (generate/adjust/import) exige as duas metades.
const PLANO_GERADO = JSON.stringify({
  summary: "Plano gerado pela IA",
  workout: {
    split: "Full body IA",
    daysPerWeek: 3,
    sessions: [
      { day: "A", focus: "Geral", exercises: [{ name: "Leg press", sets: 3, reps: "10", restSeconds: 60, notes: "" }] },
    ],
  },
  diet: {
    dailyCalories: 2100,
    macros: { proteinG: 160, carbsG: 210, fatG: 65 },
    meals: [{ name: "Almoço", timeHint: "12:00", items: [{ food: "Frango", quantity: "150g" }] }],
    notes: "",
  },
  disclaimer: "Aviso genérico da IA.",
});

/** Dublê de IA — só o teste do sintoma 5 (geração parcial) fala com ela aqui. */
class EspiaoDeProvider implements AIProvider {
  readonly name = "espiao";
  readonly aceitaImagem = false;
  proximaResposta = PLANO_GERADO;
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
    ProfessionalLink.deleteMany({}),
    ProfessionalInvite.deleteMany({}),
    ProMessage.deleteMany({}),
  ]);
  espiao.proximaResposta = PLANO_GERADO;
});

let n = 0;
async function registrar(): Promise<{ token: string; id: mongoose.Types.ObjectId }> {
  n += 1;
  const r = await request(app)
    .post("/auth/register")
    .send({ name: `Pessoa ${n}`, email: `metade${n}@teste.com`, password: "senha-bem-longa" });
  const id = new mongoose.Types.ObjectId(r.body.user.id as string);
  await User.updateOne({ _id: id }, { $set: { tier: "premium", premiumSource: "admin" } });
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

async function registrarProfissional(papel: "coach" | "nutri") {
  const p = await registrar();
  await User.updateOne(
    { _id: p.id },
    { $set: { [`pro.${papel}`]: { ativo: true, origem: "manual", limiteDeAlunos: 10 } } }
  );
  return p;
}

async function vincular(
  proToken: string,
  alunoToken: string,
  papel: "coach" | "nutri",
  escopo: Record<string, boolean> = {}
) {
  const c = await request(app).post("/pro/convites").set(auth(proToken)).send({ papel });
  expect(c.status).toBe(201);
  const r = await request(app)
    .post(`/pro/convites/${c.body.data.code}/aceitar`)
    .set(auth(alunoToken))
    .send(escopo);
  expect(r.status).toBe(201);
}

const dietaExemplo = {
  dailyCalories: 1800,
  macros: { proteinG: 140, carbsG: 180, fatG: 50 },
  meals: [{ name: "Almoço", timeHint: "12h", items: [{ food: "Frango", quantity: "150g" }] }],
  notes: "",
};

const treinoExemplo = {
  split: "AB",
  daysPerWeek: 2,
  sessions: [
    {
      day: "A — Peito",
      focus: "Superior",
      exercises: [{ name: "Supino reto", sets: 4, reps: "8-12", restSeconds: 90, notes: "" }],
    },
  ],
};

async function planoAtual(userId: mongoose.Types.ObjectId) {
  return Plan.findOne({ user: userId }).sort({ version: -1 });
}

describe("Sintoma 1+2 — autoria por metade sobrevive à prescrição da outra", () => {
  it("o treinador prescreve treino depois do nutri prescrever dieta: a dieta continua do nutri", async () => {
    const nutri = await registrarProfissional("nutri");
    const coach = await registrarProfissional("coach");
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token, "nutri", { dieta: true, treinos: false });
    await vincular(coach.token, aluno.token, "coach", { dieta: false, treinos: true });

    await request(app)
      .put(`/pro/alunos/${aluno.id}/dieta`)
      .set(auth(nutri.token))
      .send({ summary: "Dieta inicial", diet: dietaExemplo })
      .expect(201);

    await request(app)
      .put(`/pro/alunos/${aluno.id}/treino`)
      .set(auth(coach.token))
      .send({ summary: "Treino novo", workout: treinoExemplo })
      .expect(201);

    const plan = await planoAtual(aluno.id);
    expect(plan!.dietCreatedBy?.toString()).toBe(nutri.id.toString());
    expect(plan!.workoutCreatedBy?.toString()).toBe(coach.id.toString());
  });
});

describe("Sintoma 2 — edição in place deixa de mentir", () => {
  it("o aluno edita a própria dieta in place (sem nutricionista): dietCreatedBy vira o aluno, workoutCreatedBy não muda", async () => {
    const aluno = await registrar();

    // Plano semeado direto no banco, como um plano gerado pela IA de antes
    // desta tarefa: workoutCreatedBy nulo, "a IA escreveu".
    await Plan.create({
      user: aluno.id,
      version: 1,
      summary: "plano da IA",
      workout: treinoExemplo,
      diet: dietaExemplo,
      disclaimer: "aviso",
      createdBy: null,
      workoutCreatedBy: null,
      workoutEm: new Date("2026-09-01T00:00:00Z"),
    });

    const dietaEditada = { ...dietaExemplo, dailyCalories: 1950 };
    const r = await request(app)
      .put("/plans/current")
      .set(auth(aluno.token))
      .send({ diet: dietaEditada })
      .expect(200);
    expect(r.body.plan.version).toBe(1); // edição in place — não cria versão

    const plan = await planoAtual(aluno.id);
    expect(plan!.dietCreatedBy?.toString()).toBe(aluno.id.toString());
    expect(plan!.dietEm).toBeInstanceOf(Date);
    // O treino não foi tocado nesta chamada — a autoria dele continua a mesma.
    expect(plan!.workoutCreatedBy).toBeNull();
    expect(plan!.workoutEm?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("Sintoma 3 — represcrição idêntica deixa de ser inferência", () => {
  it("o nutri B reenvia a MESMA dieta de A: dietCreatedBy é B, dietEm é agora", async () => {
    const nutriA = await registrarProfissional("nutri");
    const nutriB = await registrarProfissional("nutri");
    const aluno = await registrar();
    await vincular(nutriA.token, aluno.token, "nutri", { dieta: true, treinos: false });

    await request(app)
      .put(`/pro/alunos/${aluno.id}/dieta`)
      .set(auth(nutriA.token))
      .send({ summary: "Dieta inicial", diet: dietaExemplo })
      .expect(201);
    const depoisDeA = await planoAtual(aluno.id);
    const emDeA = depoisDeA!.dietEm;

    // Um segundo vínculo de nutri sobre o MESMO aluno: `vinculosAtivos` é
    // por (aluno, profissional), então o vínculo de A não atrapalha o de B.
    await vincular(nutriB.token, aluno.token, "nutri", { dieta: true, treinos: false });

    const antes = Date.now();
    // MESMO CONTEÚDO — é exatamente o caso que `autoriaDaDieta` não resolvia:
    // a dieta de B é, byte a byte, igual à de A.
    await request(app)
      .put(`/pro/alunos/${aluno.id}/dieta`)
      .set(auth(nutriB.token))
      .send({ summary: "Dieta inicial", diet: dietaExemplo })
      .expect(201);

    const depoisDeB = await planoAtual(aluno.id);
    expect(depoisDeB!.dietCreatedBy?.toString()).toBe(nutriB.id.toString());
    expect(depoisDeB!.dietEm!.getTime()).toBeGreaterThanOrEqual(antes);
    // E não é mais A — é isto que a heurística por conteúdo não conseguia dizer.
    expect(depoisDeB!.dietEm!.getTime()).not.toBe(emDeA!.getTime());
  });
});

describe("Sintoma 4 — o aviso de cada metade sobrevive ao trabalho na outra", () => {
  it("a dieta do nutri carrega o aviso dele, o treino do coach carrega o aviso dele — nenhum apaga o outro", async () => {
    const nutri = await registrarProfissional("nutri");
    const coach = await registrarProfissional("coach");
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token, "nutri", { dieta: true, treinos: false });
    await vincular(coach.token, aluno.token, "coach", { dieta: false, treinos: true });

    await request(app)
      .put(`/pro/alunos/${aluno.id}/dieta`)
      .set(auth(nutri.token))
      .send({ summary: "Dieta inicial", diet: dietaExemplo })
      .expect(201);
    await request(app)
      .put(`/pro/alunos/${aluno.id}/treino`)
      .set(auth(coach.token))
      .send({ summary: "Treino novo", workout: treinoExemplo })
      .expect(201);

    const plan = await planoAtual(aluno.id);
    expect(plan!.dietDisclaimer).toMatch(/dieta/i);
    expect(plan!.workoutDisclaimer).toMatch(/treino/i);
    expect(plan!.dietDisclaimer).not.toBe(plan!.workoutDisclaimer);
  });
});

describe("Sintoma 5 — geração parcial não perde a autoria de quem gerou", () => {
  it("/plans/generate com dieta de profissional preservada: dietCreatedBy sobrevive, workoutCreatedBy fica nulo", async () => {
    const nutri = await registrarProfissional("nutri");
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token, "nutri", { dieta: true, treinos: false });

    await request(app)
      .put(`/pro/alunos/${aluno.id}/dieta`)
      .set(auth(nutri.token))
      .send({ summary: "Dieta do nutri", diet: dietaExemplo })
      .expect(201);

    // Sem treinador: a IA escreve o treino livremente. A dieta é do
    // nutricionista e a rota tem que descartar a que a IA gerou.
    const r = await request(app).post("/plans/generate").set(auth(aluno.token)).send({}).expect(201);
    expect(r.body.plan.workout.split).toBe("Full body IA");

    const plan = await planoAtual(aluno.id);
    expect(plan!.dietCreatedBy?.toString()).toBe(nutri.id.toString());
    expect(plan!.workoutCreatedBy).toBeNull();
    expect(plan!.workoutEm).toBeInstanceOf(Date);
  });
});

describe("Sintoma 6 — plano antigo, sem os campos novos, continua respondendo pelo caminho de sempre", () => {
  it("GET /pro/alunos/:id/dieta cai em autoriaDaDieta quando dietEm não existe", async () => {
    const nutri = await registrarProfissional("nutri");
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token, "nutri", { dieta: true, treinos: false });

    // Plano gravado como se fosse de ANTES desta tarefa: nenhum dos seis
    // campos novos existe no documento.
    await Plan.create({
      user: aluno.id,
      version: 1,
      summary: "plano antigo",
      workout: null,
      diet: dietaExemplo,
      disclaimer: "aviso",
      createdBy: nutri.id,
    });

    const r = await request(app).get(`/pro/alunos/${aluno.id}/dieta`).set(auth(nutri.token)).expect(200);
    // `autoriaDaDieta` é quem responde aqui — mesmo resultado de sempre.
    expect(r.body.data.createdBy).toBe(nutri.id.toString());
    expect(r.body.data.diet.dailyCalories).toBe(dietaExemplo.dailyCalories);
  });
});

describe("Sintoma 7 — o disclaimer do documento continua sendo gravado, para o APK antigo", () => {
  it("PUT /pro/alunos/:id/dieta e /treino continuam gravando o disclaimer de topo", async () => {
    const nutri = await registrarProfissional("nutri");
    const aluno = await registrar();
    await vincular(nutri.token, aluno.token, "nutri", { dieta: true, treinos: false });

    await request(app)
      .put(`/pro/alunos/${aluno.id}/dieta`)
      .set(auth(nutri.token))
      .send({ summary: "Dieta do nutri", diet: dietaExemplo })
      .expect(201);

    const plan = await planoAtual(aluno.id);
    // O campo antigo, que `serializePlan`/o app 1.2.0 leem, continua com
    // conteúdo — nunca vazio nem ausente.
    expect(typeof plan!.disclaimer).toBe("string");
    expect(plan!.disclaimer.length).toBeGreaterThan(0);
  });

  it("/plans/generate continua gravando o disclaimer de topo", async () => {
    const aluno = await registrar();
    const r = await request(app).post("/plans/generate").set(auth(aluno.token)).send({}).expect(201);
    expect(typeof r.body.plan.disclaimer).toBe("string");
    expect(r.body.plan.disclaimer.length).toBeGreaterThan(0);
  });
});
