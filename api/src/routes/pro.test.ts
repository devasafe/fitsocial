import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Activity } from "../models/Activity.js";
import { ProfessionalLink } from "../models/ProfessionalLink.js";
import { ProfessionalInvite } from "../models/ProfessionalInvite.js";

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
  ]);
});

async function convite(token: string, papel: "coach" | "nutri" = "coach", usos = 1) {
  const r = await request(app).post("/pro/convites").set(auth(token)).send({ papel, usos });
  expect(r.status).toBe(201);
  return r.body.data.code as string;
}

async function vincular(coachToken: string, alunoToken: string, escopo = {}) {
  const code = await convite(coachToken);
  const r = await request(app)
    .post(`/pro/convites/${code}/aceitar`)
    .set(auth(alunoToken))
    .send(escopo);
  expect(r.status).toBe(201);
  return r.body.data.id as string;
}

describe("acesso ao painel", () => {
  it("quem não é profissional não passa", async () => {
    const qualquer = await registrar();

    for (const [metodo, rota] of [
      ["get", "/pro/me"],
      ["get", "/pro/alunos"],
      ["get", "/pro/convites"],
    ] as const) {
      const r = await request(app)[metodo](rota).set(auth(qualquer.token));
      expect(r.status).toBe(403);
    }
    const post = await request(app).post("/pro/convites").set(auth(qualquer.token)).send({ papel: "coach" });
    expect(post.status).toBe(403);
  });

  it("sem token, 401", async () => {
    expect((await request(app).get("/pro/alunos")).status).toBe(401);
  });

  // O acesso é lido do documento a cada requisição: revogar tem efeito na hora,
  // sem esperar token expirar.
  it("revogar a capacidade fecha o painel imediatamente", async () => {
    const coach = await registrarProfissional();
    expect((await request(app).get("/pro/me").set(auth(coach.token))).status).toBe(200);

    const u = (await User.findById(coach.id))!;
    u.set("pro.coach.ativo", false);
    await u.save();

    expect((await request(app).get("/pro/me").set(auth(coach.token))).status).toBe(403);
  });

  it("o painel diz o teto e quantos alunos já entraram", async () => {
    const coach = await registrarProfissional("coach", 10);
    await vincular(coach.token, (await registrar()).token);

    const r = await request(app).get("/pro/me").set(auth(coach.token));
    expect(r.body.data.capacidades).toEqual([{ papel: "coach", ativo: true, limite: 10, alunos: 1 }]);
  });
});

describe("convite e aceite pela API", () => {
  it("o aluno vê de quem é o convite antes de aceitar", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    const code = await convite(coach.token);

    const r = await request(app).get(`/pro/convites/${code}`).set(auth(aluno.token));

    expect(r.status).toBe(200);
    expect(r.body.data.profissional.id).toBe(coach.id);
    expect(r.body.data.jaVinculado).toBe(false);
  });

  it("aceitar cria o vínculo, e o aluno passa a ver quem o acompanha", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    await vincular(coach.token, aluno.token);

    const meus = await request(app).get("/pro/acompanhamentos").set(auth(aluno.token));
    expect(meus.body.data).toHaveLength(1);
    expect(meus.body.data[0].profissional.id).toBe(coach.id);
    expect(meus.body.data[0].escopo.treinos).toBe(true);
    expect(meus.body.data[0].escopo.fotos).toBe(false);
  });

  it("o aluno muda o escopo e sai quando quiser", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    const linkId = await vincular(coach.token, aluno.token);

    const patch = await request(app)
      .patch(`/pro/acompanhamentos/${linkId}`)
      .set(auth(aluno.token))
      .send({ medidas: true });
    expect(patch.body.data.escopo.medidas).toBe(true);

    const del = await request(app).delete(`/pro/acompanhamentos/${linkId}`).set(auth(aluno.token));
    expect(del.body.data.status).toBe("encerrado");

    const depois = await request(app).get("/pro/acompanhamentos").set(auth(aluno.token));
    expect(depois.body.data).toHaveLength(0);
  });

  it("o profissional revoga um convite que ainda não foi usado", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    const code = await convite(coach.token);

    await request(app).delete(`/pro/convites/${code}`).set(auth(coach.token)).expect(200);

    const r = await request(app).post(`/pro/convites/${code}/aceitar`).set(auth(aluno.token)).send({});
    expect(r.status).toBe(410);
  });

  it("um coach não revoga convite de outro", async () => {
    const a = await registrarProfissional();
    const b = await registrarProfissional();
    const code = await convite(a.token);

    expect((await request(app).delete(`/pro/convites/${code}`).set(auth(b.token))).status).toBe(404);
  });

  it("lotado, o convite não sai", async () => {
    const coach = await registrarProfissional("coach", 1);
    await vincular(coach.token, (await registrar()).token);

    const r = await request(app).post("/pro/convites").set(auth(coach.token)).send({ papel: "coach" });
    expect(r.status).toBe(409);
  });
});

describe("a lista de alunos", () => {
  it("mostra quando cada um treinou pela última vez", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    await vincular(coach.token, aluno.token);

    await request(app)
      .post("/activities")
      .set(auth(aluno.token))
      .send({
        sportId: "musculacao",
        kind: "strength",
        payload: { variant: "musculacao", exercises: [{ name: "Supino", sets: [{ type: "valida", weightKg: 80, reps: 5 }] }] },
      });

    const r = await request(app).get("/pro/alunos").set(auth(coach.token));

    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0].aluno.id).toBe(aluno.id);
    expect(r.body.data[0].treinos.naSemana).toBe(1);
    expect(r.body.data[0].treinos.ultimoEm).toBeTruthy();
  });

  // A diferença entre "não treinou" e "não me deixou ver" é o que o
  // profissional precisa saber — zero nos dois casos seria mentira.
  it("aluno que fechou os treinos aparece sem números, não com zero", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    const linkId = await vincular(coach.token, aluno.token);
    await request(app)
      .patch(`/pro/acompanhamentos/${linkId}`)
      .set(auth(aluno.token))
      .send({ treinos: false });

    const r = await request(app).get("/pro/alunos").set(auth(coach.token));
    expect(r.body.data[0].treinos).toBeNull();
  });

  it("cada coach vê só os próprios alunos", async () => {
    const a = await registrarProfissional();
    const b = await registrarProfissional();
    await vincular(a.token, (await registrar()).token);

    const r = await request(app).get("/pro/alunos").set(auth(b.token));
    expect(r.body.data).toHaveLength(0);
  });
});

describe("o perfil do aluno", () => {
  it("traz a evolução e a constância de quem autorizou", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    await vincular(coach.token, aluno.token);

    for (const peso of [80, 90]) {
      await request(app)
        .post("/activities")
        .set(auth(aluno.token))
        .send({
          sportId: "musculacao",
          kind: "strength",
          payload: { variant: "musculacao", exercises: [{ name: "Supino reto", sets: [{ type: "valida", weightKg: peso, reps: 5 }] }] },
        });
    }

    const r = await request(app).get(`/pro/alunos/${aluno.id}`).set(auth(coach.token));

    expect(r.status).toBe(200);
    expect(r.body.data.aluno.id).toBe(aluno.id);
    expect(r.body.data.exercicios[0].slug).toBe("supino_reto");
    expect(r.body.data.exercicios[0].melhor).toBe(90);
    expect(r.body.data.constancia.total).toBe(2);
    expect(Array.isArray(r.body.data.calendario)).toBe(true);
  });

  it("quem não é meu aluno é 404, não uma página vazia", async () => {
    const coach = await registrarProfissional();
    const estranho = await registrar();

    const r = await request(app).get(`/pro/alunos/${estranho.id}`).set(auth(coach.token));
    expect(r.status).toBe(404);
  });

  it("aluno que fechou os treinos dá 403 — diferente de não ter treinado", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    const linkId = await vincular(coach.token, aluno.token);
    await request(app)
      .patch(`/pro/acompanhamentos/${linkId}`)
      .set(auth(aluno.token))
      .send({ treinos: false });

    const r = await request(app).get(`/pro/alunos/${aluno.id}`).set(auth(coach.token));
    expect(r.status).toBe(403);
  });

  it("depois de encerrado, o perfil fecha", async () => {
    const coach = await registrarProfissional();
    const aluno = await registrar();
    const linkId = await vincular(coach.token, aluno.token);

    await request(app).delete(`/pro/alunos/${linkId}`).set(auth(coach.token)).expect(200);

    const r = await request(app).get(`/pro/alunos/${aluno.id}`).set(auth(coach.token));
    expect(r.status).toBe(404);
  });

  it("id inválido não derruba a rota", async () => {
    const coach = await registrarProfissional();
    const r = await request(app).get("/pro/alunos/nao-e-um-id").set(auth(coach.token));
    expect(r.status).toBe(404);
  });
});
