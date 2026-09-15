import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Activity } from "../models/Activity.js";
import { ProfessionalLink } from "../models/ProfessionalLink.js";
import { ProfessionalInvite } from "../models/ProfessionalInvite.js";
import { Plan } from "../models/Plan.js";
import { FoodLog } from "../models/FoodLog.js";
import { ProMessage } from "../models/ProMessage.js";

const app = createApp();
let mongod: MongoMemoryServer;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Um agente HTTP já autenticado, para ler os testes como no brief: `comoNutri.get(...)`. */
function como(token: string) {
  return { get: (path: string) => request(app).get(path).set(auth(token)) };
}

let n = 0;
async function registrar(): Promise<{ token: string; id: string }> {
  n++;
  const r = await request(app)
    .post("/auth/register")
    .send({ name: `P${n}`, email: `pro${n}@teste.com`, password: "senha-bem-longa" });
  return { token: r.body.token, id: r.body.user.id };
}

/** Registra e libera a capacidade, como o script `pro:grant` faria. */
async function registrarProfissional(papel: "coach" | "nutri" = "coach", limite = 10) {
  const p = await registrar();
  const u = (await User.findById(p.id))!;
  u.set(`pro.${papel}`, { ativo: true, origem: "manual", limiteDeAlunos: limite });
  await u.save();
  return p;
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Activity.deleteMany({}),
    ProfessionalLink.deleteMany({}),
    ProfessionalInvite.deleteMany({}),
    Plan.deleteMany({}),
    FoodLog.deleteMany({}),
    ProMessage.deleteMany({}),
  ]);
});

async function convite(token: string, papel: "coach" | "nutri" = "coach", usos = 1) {
  const r = await request(app).post("/pro/convites").set(auth(token)).send({ papel, usos });
  expect(r.status).toBe(201);
  return r.body.data.code as string;
}

async function vincular(
  proToken: string,
  alunoToken: string,
  escopo = {},
  papel: "coach" | "nutri" = "coach"
) {
  const code = await convite(proToken, papel);
  const r = await request(app)
    .post(`/pro/convites/${code}/aceitar`)
    .set(auth(alunoToken))
    .send(escopo);
  expect(r.status).toBe(201);
  return r.body.data.id as string;
}

describe("GET /pro/alunos/:id/nutricao", () => {
  let nutri: { token: string; id: string };
  let nutriSemEscopo: { token: string; id: string };
  let estranho: { token: string; id: string };
  let aluno: { token: string; id: string };
  let alunoId: string;
  let comoNutri: ReturnType<typeof como>;
  let comoNutriSemEscopo: ReturnType<typeof como>;
  let comoEstranho: ReturnType<typeof como>;
  let comoAluno: ReturnType<typeof como>;

  beforeEach(async () => {
    nutri = await registrarProfissional("nutri");
    nutriSemEscopo = await registrarProfissional("nutri");
    estranho = await registrarProfissional("nutri");
    aluno = await registrar();
    alunoId = aluno.id;

    await vincular(nutri.token, aluno.token, { dieta: true, treinos: false }, "nutri");
    await vincular(nutriSemEscopo.token, aluno.token, { dieta: false, treinos: false }, "nutri");

    comoNutri = como(nutri.token);
    comoNutriSemEscopo = como(nutriSemEscopo.token);
    comoEstranho = como(estranho.token);
    comoAluno = como(aluno.token);
  });

  it("nutri com dieta aberta recebe a série", async () => {
    const r = await comoNutri.get(`/pro/alunos/${alunoId}/nutricao?dias=7`).expect(200);
    expect(r.body.data.dias).toHaveLength(7);
    expect(r.body.data.resumo.diasNaJanela).toBe(7);
  });

  it("dia sem registro chega null, e não zero — igual ao lado do aluno", async () => {
    const r = await comoNutri.get(`/pro/alunos/${alunoId}/nutricao?dias=7`).expect(200);
    expect(r.body.data.dias[0].kcal).toBeNull();
  });

  it("nutri SEM dieta aberta recebe 403 dizendo que é a dieta", async () => {
    const r = await comoNutriSemEscopo.get(`/pro/alunos/${alunoId}/nutricao`).expect(403);
    expect(r.body.error).toMatch(/dieta/i);
  });

  it("estranho recebe 404", async () => {
    await comoEstranho.get(`/pro/alunos/${alunoId}/nutricao`).expect(404);
  });

  it("A RESPOSTA É IDÊNTICA à que o próprio aluno recebe", async () => {
    // Regra do projeto: os dois lados chamam a MESMA função. Este teste é o que
    // quebra se alguém reimplementar o cálculo de um dos lados.
    //
    // O painel não paga a janela do plano do aluno (não aplica `janelaPermitida`),
    // então para pedir a MESMA janela dos dois lados o aluno precisa estar num
    // plano pago aqui — senão o lado dele cortaria para 7 dias e o do painel não,
    // e a comparação falharia por um motivo que não é o que este teste investiga.
    await User.updateOne({ _id: alunoId }, { $set: { plan: "pro" } });

    const doAluno = await comoAluno.get("/nutrition/evolucao?dias=30").expect(200);
    const doPro = await comoNutri.get(`/pro/alunos/${alunoId}/nutricao?dias=30`).expect(200);
    expect(doPro.body.data).toEqual(doAluno.body.data);
  });
});
