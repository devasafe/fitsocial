// Tarefa 4 (frente "treino duplicado e CRUD", 16/09/2026): `DELETE /activities/:id`
// hoje só faz `Activity.deleteOne` — o post ligado ao treino sobrevive apontando
// para nada, e o recorde que só existia por causa dele fica no quadro de PRs
// para sempre. Este arquivo cobre o conserto: apagar o treino leva o post
// (com curtidas e comentários) e reconstrói os recordes da pessoa.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { Activity } from "../models/Activity.js";
import { Post } from "../models/Post.js";
import { Comment } from "../models/Comment.js";
import { Like } from "../models/Like.js";
import { PersonalRecord } from "../models/PersonalRecord.js";
import { User } from "../models/User.js";

const app = createApp();
let mongod: MongoMemoryServer;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Um agente HTTP já autenticado, só com os verbos que este arquivo usa. */
function como(token: string) {
  return {
    post: (path: string) => request(app).post(path).set(auth(token)),
    delete: (path: string) => request(app).delete(path).set(auth(token)),
  };
}

let n = 0;
async function registrar(): Promise<{ token: string; id: string }> {
  n++;
  const r = await request(app)
    .post("/auth/register")
    .send({ name: `Del${n}`, email: `del${n}@teste.com`, password: "senha12345" });
  return { token: r.body.token, id: r.body.user.id };
}

// Um coach precisa de `pro.coach.ativo` para poder gerar convite — a
// mesma preparação usada em planoPorDiaDaSemana.test.ts.
async function registrarCoach() {
  const p = await registrar();
  const u = (await User.findById(p.id))!;
  u.set("pro.coach", { ativo: true, origem: "manual", limiteDeAlunos: 10 });
  await u.save();
  return p;
}

async function vincular(coachToken: string, alunoToken: string) {
  const c = await request(app).post("/pro/convites").set(auth(coachToken)).send({ papel: "coach" });
  expect(c.status).toBe(201);
  const r = await request(app)
    .post(`/pro/convites/${c.body.data.code}/aceitar`)
    .set(auth(alunoToken))
    .send({ treinos: true });
  expect(r.status).toBe(201);
}

// `reps: 0` de propósito: com reps>0 o motor de PR (Tarefa 2c, prEngine.ts)
// também gera `rm_estimado` e `carga_faixa` para o MESMO exercício, e os
// testes de contagem de PR abaixo querem exatamente um recorde por treino.
function strengthBody(exerciseName: string, weightKg: number, over: Record<string, unknown> = {}) {
  return {
    sportId: "musculacao",
    kind: "strength",
    payload: {
      exercises: [{ name: exerciseName, sets: [{ type: "valida", weightKg, reps: 0 }] }],
    },
    ...over,
  };
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
    Post.deleteMany({}),
    Comment.deleteMany({}),
    Like.deleteMany({}),
    PersonalRecord.deleteMany({}),
  ]);
});

describe("DELETE /activities/:id — apagar de verdade", () => {
  it("apagar o treino apaga o post ligado, com curtidas e comentários", async () => {
    const dono = await registrar();
    const outro = await registrar();

    const criado = await como(dono.token)
      .post("/activities")
      .send(strengthBody("Supino", 100, { shareToFeed: true }));
    expect(criado.status).toBe(201);
    const atividadeId = criado.body.data.id;
    const postId = criado.body.meta.sharedPostId;
    expect(postId).toBeTruthy();

    // Post que conta um treino que não aconteceu é mentira no feed dos
    // outros — por isso curtida e comentário de OUTRA pessoa também têm de
    // sumir junto.
    await como(outro.token).post(`/social/posts/${postId}/like`);
    await como(outro.token).post(`/social/posts/${postId}/comments`).send({ text: "boa!" });
    expect(await Like.countDocuments({ post: postId })).toBe(1);
    expect(await Comment.countDocuments({ post: postId })).toBe(1);

    await como(dono.token).delete(`/activities/${atividadeId}`).expect(200);

    expect(await Post.countDocuments({ activity: atividadeId })).toBe(0);
    expect(await Comment.countDocuments({ post: postId })).toBe(0);
    expect(await Like.countDocuments({ post: postId })).toBe(0);
  });

  it("apagar o treino derruba o recorde que só existia por causa dele", async () => {
    const dono = await registrar();
    const criado = await como(dono.token).post("/activities").send(strengthBody("Supino", 100));
    expect(criado.status).toBe(201);
    const atividadeId = criado.body.data.id;

    // Antes: o treino sumia e o recorde ficava. A pessoa via um PR de 100kg
    // de um treino que ela mesma apagou, sem nenhum jeito de tirar.
    expect(await PersonalRecord.countDocuments({ user: dono.id })).toBeGreaterThan(0);

    await como(dono.token).delete(`/activities/${atividadeId}`).expect(200);

    expect(await PersonalRecord.countDocuments({ user: dono.id })).toBe(0);
  });

  it("o recorde de OUTRO treino sobrevive", async () => {
    // `recomputeUserPRs` reconstrói do zero: o teste acima passaria mesmo se
    // a implementação apagasse tudo. Este prende a diferença.
    const dono = await registrar();
    const pesado = await como(dono.token).post("/activities").send(strengthBody("Supino", 100));
    expect(pesado.status).toBe(201);
    const leve = await como(dono.token).post("/activities").send(strengthBody("Agachamento", 40));
    expect(leve.status).toBe(201);
    const treinoLeveId = leve.body.data.id;

    await como(dono.token).delete(`/activities/${treinoLeveId}`).expect(200);

    const prs = await PersonalRecord.find({ user: dono.id });
    expect(prs.length).toBe(1);
    expect(prs[0]!.value).toBe(100);
  });

  it("não dá para apagar o treino de outra pessoa, e a resposta é 404", async () => {
    const dono = await registrar();
    const outro = await registrar();
    const criado = await como(dono.token).post("/activities").send(strengthBody("Supino", 100));
    const atividadeId = criado.body.data.id;

    // 403 confirmaria para um estranho que aquele treino existe.
    await como(outro.token).delete(`/activities/${atividadeId}`).expect(404);
    expect(await Activity.countDocuments({ _id: atividadeId })).toBe(1);
  });

  it("apagar continua livre para quem tem treinador", async () => {
    // O treino é da pessoa; o profissional acompanha, não é dono. Diferente
    // da dieta, onde a trava existe porque lá o profissional ESCREVE.
    const coach = await registrarCoach();
    const aluno = await registrar();
    await vincular(coach.token, aluno.token);

    const criado = await como(aluno.token).post("/activities").send(strengthBody("Supino", 100));
    const doAlunoId = criado.body.data.id;

    await como(aluno.token).delete(`/activities/${doAlunoId}`).expect(200);
  });
});
