// Tarefa 5 (frente "treino duplicado e CRUD", 16/09/2026): `PATCH /activities/:id`
// hoje só aceita `payload` de força (`strengthPayloadSchema`) — editar uma corrida
// ou um WOD é impossível —, não refaz recorde nenhum ao editar os números, e não
// deixa corrigir `startedAt` ("registrei no dia errado"). Este arquivo cobre o
// conserto: `editarAtividade` alcança todos os tipos, recalcula métricas pelo
// mesmo caminho do `createActivity` e reconstrói os recordes.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { Activity } from "../models/Activity.js";
import { PersonalRecord } from "../models/PersonalRecord.js";
import { User } from "../models/User.js";

const app = createApp();
let mongod: MongoMemoryServer;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Um agente HTTP já autenticado, só com os verbos que este arquivo usa. */
function como(token: string) {
  return {
    post: (path: string) => request(app).post(path).set(auth(token)),
    patch: (path: string) => request(app).patch(path).set(auth(token)),
  };
}

let n = 0;
async function registrar(): Promise<{ token: string; id: string }> {
  n++;
  const r = await request(app)
    .post("/auth/register")
    .send({ name: `Edit${n}`, email: `edit${n}@teste.com`, password: "senha12345" });
  return { token: r.body.token, id: r.body.user.id };
}

// `reps: 0` de propósito: com reps>0 o motor de PR também gera `rm_estimado` e
// `carga_faixa` para o MESMO exercício — mesmo motivo do apagarTreino.test.ts.
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
  await Promise.all([User.deleteMany({}), Activity.deleteMany({}), PersonalRecord.deleteMany({})]);
});

describe("PATCH /activities/:id — editar de verdade", () => {
  it("corrigir o peso para menos derruba o recorde que ele criou", async () => {
    const dono = await registrar();
    const criado = await como(dono.token).post("/activities").send(strengthBody("Supino", 100));
    const id = criado.body.data.id;
    expect((await PersonalRecord.findOne({ user: dono.id }))!.value).toBe(100);

    await como(dono.token)
      .patch(`/activities/${id}`)
      .send({ payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] } })
      .expect(200);

    const pr = await PersonalRecord.findOne({ user: dono.id });
    expect(pr!.value).toBe(80);
  });

  it("corrigir o peso para mais cria o recorde", async () => {
    const dono = await registrar();
    const criado = await como(dono.token).post("/activities").send(strengthBody("Supino", 100));
    const id = criado.body.data.id;

    await como(dono.token)
      .patch(`/activities/${id}`)
      .send({ payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 120, reps: 8 }] }] } })
      .expect(200);

    expect((await PersonalRecord.findOne({ user: dono.id }))!.value).toBe(120);
  });

  it("dá para corrigir a data de um treino registrado no dia errado", async () => {
    const dono = await registrar();
    const criado = await como(dono.token).post("/activities").send(strengthBody("Supino", 100));
    const id = criado.body.data.id;

    const ontem = new Date(Date.now() - 24 * 3600_000).toISOString();
    const r = await como(dono.token).patch(`/activities/${id}`).send({ startedAt: ontem }).expect(200);
    expect(new Date(r.body.data.startedAt).toDateString()).toBe(new Date(ontem).toDateString());
  });

  it("editar uma corrida funciona — não só treino de força", async () => {
    const dono = await registrar();
    const criado = await como(dono.token)
      .post("/activities")
      .send({ sportId: "corrida", kind: "endurance", durationSec: 1800, payload: { distanceM: 5000 } });
    const corridaId = criado.body.data.id;

    await como(dono.token)
      .patch(`/activities/${corridaId}`)
      .send({ payload: { distanceM: 10_000 } })
      .expect(200);

    const a = await Activity.findById(corridaId);
    expect((a!.metrics as { distanceKm: number }).distanceKm).toBe(10);
  });

  it("não dá para trocar o tipo nem o esporte do treino", async () => {
    // Transformar força em corrida não é editar, é outro treino — e deixaria o
    // payload incoerente com o tipo, que é dado impossível de interpretar depois.
    const dono = await registrar();
    const criado = await como(dono.token).post("/activities").send(strengthBody("Supino", 100));
    const id = criado.body.data.id;

    await como(dono.token).patch(`/activities/${id}`).send({ kind: "endurance" }).expect(400);
    await como(dono.token).patch(`/activities/${id}`).send({ sportId: "corrida" }).expect(400);
  });

  it("não dá para editar o treino de outra pessoa, e a resposta é 404", async () => {
    const dono = await registrar();
    const outro = await registrar();
    const criado = await como(dono.token).post("/activities").send(strengthBody("Supino", 100));
    const id = criado.body.data.id;

    await como(outro.token).patch(`/activities/${id}`).send({ title: "meu" }).expect(404);
  });

  it("o resumo de recorde gravado no treino acompanha a edição", async () => {
    // É denormalizado para o cartão de compartilhar não consultar o banco. Se
    // ficar para trás, o cartão anuncia um recorde que não existe mais.
    const dono = await registrar();
    const criado = await como(dono.token).post("/activities").send(strengthBody("Supino", 100));
    const id = criado.body.data.id;

    await como(dono.token)
      .patch(`/activities/${id}`)
      .send({ payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 40, reps: 8 }] }] } })
      .expect(200);

    const a = await Activity.findById(id);
    expect((a!.metrics as { prs?: unknown[] }).prs ?? []).toHaveLength(0);
  });
});
