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

describe("A ficha abre pelo vínculo, e cada bloco pelo escopo", () => {
  let nutri: { token: string; id: string };
  let coach: { token: string; id: string };
  let estranho: { token: string; id: string };
  let aluno: { token: string; id: string };
  let alunoId: string;

  beforeEach(async () => {
    nutri = await registrarProfissional("nutri");
    coach = await registrarProfissional("coach");
    estranho = await registrarProfissional("coach");
    aluno = await registrar();
    alunoId = aluno.id;

    await vincular(nutri.token, aluno.token, { dieta: true, treinos: false }, "nutri");
    await vincular(coach.token, aluno.token, { treinos: true });
  });

  it("nutri com dieta aberta e treinos fechados ABRE a ficha", async () => {
    // Hoje isto é 403 e o profissional não vê nem o nome do aluno.
    const r = await request(app).get(`/pro/alunos/${alunoId}`).set(auth(nutri.token)).expect(200);
    expect(r.body.data.aluno.nome).toBeTruthy();
    expect(r.body.data.vinculo.papel).toBe("nutri");
  });

  it("com treinos fechados, os blocos de treino NÃO VÊM — e não vêm vazios", async () => {
    // Campo ausente é "não me deixou ver". Campo vazio seria "não treinou", que
    // é uma afirmação sobre a vida do aluno que nós não temos como fazer.
    const r = await request(app).get(`/pro/alunos/${alunoId}`).set(auth(nutri.token)).expect(200);
    expect(r.body.data.exercicios).toBeUndefined();
    expect(r.body.data.calendario).toBeUndefined();
    expect(r.body.data.constancia).toBeUndefined();
  });

  it("coach com treinos abertos continua vendo tudo que via", async () => {
    const r = await request(app).get(`/pro/alunos/${alunoId}`).set(auth(coach.token)).expect(200);
    expect(r.body.data.exercicios).toBeDefined();
    expect(r.body.data.calendario).toBeDefined();
    expect(r.body.data.constancia).toBeDefined();
  });

  it("rota de dado de treino com escopo fechado ainda é 403, e diz por quê", async () => {
    const r = await request(app).get(`/pro/alunos/${alunoId}/grupos`).set(auth(nutri.token)).expect(403);
    expect(r.body.error).toMatch(/treinos/i);
  });

  it("quem não é profissional do aluno recebe 404, não 403", async () => {
    // 403 diria "existe um vínculo aqui" para quem não tem nenhum.
    await request(app).get(`/pro/alunos/${alunoId}`).set(auth(estranho.token)).expect(404);
  });

  it("quem é coach E nutri do mesmo aluno recebe os dois vínculos", async () => {
    const ambos = await registrarProfissional("coach");
    const u = (await User.findById(ambos.id))!;
    u.set("pro.nutri", { ativo: true, origem: "manual", limiteDeAlunos: 10 });
    await u.save();

    const outroAluno = await registrar();
    await vincular(ambos.token, outroAluno.token, { treinos: true }, "coach");
    await vincular(ambos.token, outroAluno.token, { dieta: true }, "nutri");

    const r = await request(app).get(`/pro/alunos/${outroAluno.id}`).set(auth(ambos.token)).expect(200);
    expect(r.body.data.vinculos).toHaveLength(2);
    expect(r.body.data.vinculos.map((v: { papel: string }) => v.papel).sort()).toEqual(["coach", "nutri"]);
  });

  it("fechar treinos no vínculo de treinador fecha de verdade, mesmo com vínculo de nutri aberto por default", async () => {
    // A mesma pessoa acompanha o aluno como coach E como nutri. O aluno
    // desliga treinos no cartão do treinador; o vínculo de nutri nem foi
    // tocado e carrega o default (`treinos: true`). Quem decide `treinos` é
    // o vínculo de coach — e ele disse não.
    const ambos = await registrarProfissional("coach");
    const u = (await User.findById(ambos.id))!;
    u.set("pro.nutri", { ativo: true, origem: "manual", limiteDeAlunos: 10 });
    await u.save();

    const outroAluno = await registrar();
    await vincular(ambos.token, outroAluno.token, { treinos: false }, "coach");
    await vincular(ambos.token, outroAluno.token, { dieta: true }, "nutri");

    const ficha = await request(app)
      .get(`/pro/alunos/${outroAluno.id}`)
      .set(auth(ambos.token))
      .expect(200);
    expect(ficha.body.data.constancia).toBeUndefined();
    expect(ficha.body.data.exercicios).toBeUndefined();
    expect(ficha.body.data.calendario).toBeUndefined();

    await request(app).get(`/pro/alunos/${outroAluno.id}/grupos`).set(auth(ambos.token)).expect(403);
  });

  it("treinador com treinos abertos continua vendo, mesmo com o vínculo de nutri fechado", async () => {
    // O inverso do teste acima: garante que a Tarefa 1 (coach vendo o próprio
    // aluno mesmo quando ele também é nutri de outro vínculo) não regride.
    const ambos = await registrarProfissional("coach");
    const u = (await User.findById(ambos.id))!;
    u.set("pro.nutri", { ativo: true, origem: "manual", limiteDeAlunos: 10 });
    await u.save();

    const outroAluno = await registrar();
    await vincular(ambos.token, outroAluno.token, { treinos: true }, "coach");
    await vincular(ambos.token, outroAluno.token, { dieta: true, treinos: false }, "nutri");

    const ficha = await request(app)
      .get(`/pro/alunos/${outroAluno.id}`)
      .set(auth(ambos.token))
      .expect(200);
    expect(ficha.body.data.constancia).toBeDefined();
    expect(ficha.body.data.exercicios).toBeDefined();
    expect(ficha.body.data.calendario).toBeDefined();

    await request(app).get(`/pro/alunos/${outroAluno.id}/grupos`).set(auth(ambos.token)).expect(200);
  });

  it("só nutricionista, com treinos abertos, continua vendo treino", async () => {
    // Sem vínculo de coach nesta dupla, o único vínculo que existe decide —
    // é a única leitura possível da vontade do aluno.
    const soNutri = await registrarProfissional("nutri");
    const outroAluno = await registrar();
    await vincular(soNutri.token, outroAluno.token, { treinos: true }, "nutri");

    const ficha = await request(app)
      .get(`/pro/alunos/${outroAluno.id}`)
      .set(auth(soNutri.token))
      .expect(200);
    expect(ficha.body.data.exercicios).toBeDefined();
  });

  it("espelho para dieta: vínculo de nutri fechado vence o de coach aberto", async () => {
    const ambos = await registrarProfissional("coach");
    const u = (await User.findById(ambos.id))!;
    u.set("pro.nutri", { ativo: true, origem: "manual", limiteDeAlunos: 10 });
    await u.save();

    const outroAluno = await registrar();
    await vincular(ambos.token, outroAluno.token, { dieta: true }, "coach");
    await vincular(ambos.token, outroAluno.token, { dieta: false }, "nutri");

    await request(app).get(`/pro/alunos/${outroAluno.id}/dieta`).set(auth(ambos.token)).expect(403);
  });
});
