import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { ProfessionalLink } from "../models/ProfessionalLink.js";
import { ProfessionalInvite } from "../models/ProfessionalInvite.js";
import { recontarAlunosDe } from "./patrocinio.js";

// "O aluno acompanhado tem o acompanhamento completo, e quem paga é o
// profissional." Esta é a frase virando código — e estes testes são o que
// impede ela de deixar de ser verdade sem ninguém notar.

const app = createApp();
let mongod: MongoMemoryServer;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

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
    ProfessionalLink.deleteMany({}),
    ProfessionalInvite.deleteMany({}),
  ]);
});

let n = 0;
async function registrar() {
  n += 1;
  const r = await request(app)
    .post("/auth/register")
    .send({ name: `P${n}`, email: `pat${n}@teste.com`, password: "senha-bem-longa" });
  return { token: r.body.token as string, id: r.body.user.id as string };
}

async function profissional(papel: "coach" | "nutri" = "coach") {
  const p = await registrar();
  const u = (await User.findById(p.id))!;
  u.set(`pro.${papel}`, { ativo: true, origem: "manual", limiteDeAlunos: 10 });
  await u.save();
  return p;
}

/** Convida e aceita, como acontece de verdade pelas duas rotas. */
async function vincular(proToken: string, alunoToken: string, papel: "coach" | "nutri" = "coach") {
  const c = await request(app).post("/pro/convites").set(auth(proToken)).send({ papel, usos: 1 });
  const code = c.body.data.code as string;
  const r = await request(app).post(`/pro/convites/${code}/aceitar`).set(auth(alunoToken)).send({});
  expect(r.status).toBe(201);
  return r.body.data.id as string;
}

const planoDe = async (id: string) => (await User.findById(id))!;

describe("o aluno acompanhado ganha Pro", () => {
  it("aceitar o convite torna o aluno Pro na hora", async () => {
    const coach = await profissional();
    const aluno = await registrar();

    expect((await planoDe(aluno.id)).tier).toBe("free");

    await vincular(coach.token, aluno.token);

    const depois = await planoDe(aluno.id);
    expect(depois.vinculosPatrocinados).toBe(1);
    expect(depois.tier).toBe("premium");
  });

  it("e com isso ele vê a evolução inteira, não os 7 dias do grátis", async () => {
    // É o motivo de esta fase existir: sem ela, o mentorado via uma semana
    // enquanto o treinador dele via o ano inteiro no painel.
    const coach = await profissional();
    const aluno = await registrar();
    await vincular(coach.token, aluno.token);

    const r = await request(app).get("/evolucao/exercicios?dias=365").set(auth(aluno.token));

    expect(r.body.meta.dias).toBe(365);
    expect(r.body.meta.limitadoPor).toBeUndefined();
  });

  it("e o calendário do ano abre para ele", async () => {
    const coach = await profissional();
    const aluno = await registrar();
    await vincular(coach.token, aluno.token);

    const r = await request(app).get("/evolucao/calendario").set(auth(aluno.token));
    expect(r.status).toBe(200);
  });

  it("encerrar o acompanhamento devolve o aluno ao grátis", async () => {
    const coach = await profissional();
    const aluno = await registrar();
    const linkId = await vincular(coach.token, aluno.token);

    await request(app).delete(`/pro/acompanhamentos/${linkId}`).set(auth(aluno.token));

    const depois = await planoDe(aluno.id);
    expect(depois.vinculosPatrocinados).toBe(0);
    expect(depois.tier).toBe("free");
  });
});

describe("dois profissionais bancando a mesma pessoa", () => {
  it("encerrar com o treinador não derruba o Pro que o nutri sustenta", async () => {
    // É por isso que o campo é CONTADOR e não booleano.
    const coach = await profissional("coach");
    const nutri = await profissional("nutri");
    const aluno = await registrar();

    const doCoach = await vincular(coach.token, aluno.token, "coach");
    await vincular(nutri.token, aluno.token, "nutri");
    expect((await planoDe(aluno.id)).vinculosPatrocinados).toBe(2);

    await request(app).delete(`/pro/acompanhamentos/${doCoach}`).set(auth(aluno.token));

    const depois = await planoDe(aluno.id);
    expect(depois.vinculosPatrocinados).toBe(1);
    expect(depois.tier).toBe("premium");
  });
});

/** Tira a capacidade direto no banco, como um vencimento faria. */
async function tirarCapacidade(proId: string, papel: "coach" | "nutri" = "coach") {
  await User.updateOne({ _id: proId }, { $set: { [`pro.${papel}.ativo`]: false } });
  await recontarAlunosDe(new mongoose.Types.ObjectId(proId), papel);
}

describe("quando o profissional perde a capacidade", () => {
  it("os alunos param de ser bancados, mas os vínculos ficam de pé", async () => {
    const coach = await profissional();
    const a = await registrar();
    const b = await registrar();
    await vincular(coach.token, a.token);
    await vincular(coach.token, b.token);

    await tirarCapacidade(coach.id);

    expect((await planoDe(a.id)).tier).toBe("free");
    expect((await planoDe(b.id)).tier).toBe("free");
    // Encerrar trinta vínculos puniria trinta pessoas que não devem nada — o
    // acompanhamento continua existindo, esperando o profissional voltar.
    expect(await ProfessionalLink.countDocuments({ status: "ativo" })).toBe(2);
  });

  it("e voltam quando ela volta", async () => {
    const coach = await profissional();
    const aluno = await registrar();
    await vincular(coach.token, aluno.token);

    await tirarCapacidade(coach.id);
    expect((await planoDe(aluno.id)).tier).toBe("free");

    await User.updateOne({ _id: coach.id }, { $set: { "pro.coach.ativo": true } });
    await recontarAlunosDe(new mongoose.Types.ObjectId(coach.id), "coach");

    expect((await planoDe(aluno.id)).tier).toBe("premium");
  });

  it("recontar duas vezes não muda nada — é idempotente", async () => {
    // A versão que somava e subtraía inflava aqui: renovar o prazo de um coach
    // dava +1 nos alunos que já estavam contados, e eles viravam Pro vitalício.
    const coach = await profissional();
    const aluno = await registrar();
    await vincular(coach.token, aluno.token);

    const id = new mongoose.Types.ObjectId(coach.id);
    await recontarAlunosDe(id, "coach");
    await recontarAlunosDe(id, "coach");
    await recontarAlunosDe(id, "coach");

    expect((await planoDe(aluno.id)).vinculosPatrocinados).toBe(1);
  });

  it("revogar o coach e depois encerrar o vínculo não tira o Pro do nutri", async () => {
    // O bug da versão que subtraía: o mesmo patrocínio era descontado duas
    // vezes, e o clamp em zero engolia a contribuição do nutricionista.
    const coach = await profissional("coach");
    const nutri = await profissional("nutri");
    const aluno = await registrar();
    const doCoach = await vincular(coach.token, aluno.token, "coach");
    await vincular(nutri.token, aluno.token, "nutri");

    await tirarCapacidade(coach.id, "coach");
    await request(app).delete(`/pro/acompanhamentos/${doCoach}`).set(auth(aluno.token));

    const depois = await planoDe(aluno.id);
    expect(depois.vinculosPatrocinados).toBe(1);
    expect(depois.tier).toBe("premium");
  });
});

describe("o Pro do patrocínio tem origem própria", () => {
  it("não vira premium legado quando o acompanhamento acaba", async () => {
    // Sem origem própria, a conta ficava `tier: "premium"` sem `premiumSource`
    // depois que o vínculo encerrava — indistinguível de premium legado, e o
    // ramo que protege o legado a deixava premium para SEMPRE.
    const coach = await profissional();
    const aluno = await registrar();
    const linkId = await vincular(coach.token, aluno.token);

    expect((await planoDe(aluno.id)).premiumSource).toBe("patrocinio");

    await request(app).delete(`/pro/acompanhamentos/${linkId}`).set(auth(aluno.token));

    const depois = await planoDe(aluno.id);
    expect(depois.tier).toBe("free");
    expect(depois.premiumSource).toBeNull();
  });
});

describe("quem paga não depende do patrocínio", () => {
  it("encerrar o acompanhamento não tira o Pro de quem assina", async () => {
    const coach = await profissional();
    const aluno = await registrar();
    await User.updateOne(
      { _id: aluno.id },
      { $set: { premiumSource: "admin", premiumUntil: null } }
    );
    const linkId = await vincular(coach.token, aluno.token);

    await request(app).delete(`/pro/acompanhamentos/${linkId}`).set(auth(aluno.token));

    // Patrocínio é o ÚLTIMO ramo de `calcularPlan` justamente para isto.
    expect((await planoDe(aluno.id)).tier).toBe("premium");
  });
});
