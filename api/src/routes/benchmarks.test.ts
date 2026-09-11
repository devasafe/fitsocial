import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Activity } from "../models/Activity.js";
import { PersonalRecord } from "../models/PersonalRecord.js";

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
  await Promise.all([User.deleteMany({}), Activity.deleteMany({}), PersonalRecord.deleteMany({})]);
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let n = 0;
async function registrar() {
  n += 1;
  const r = await request(app)
    .post("/auth/register")
    .send({ name: `Pessoa ${n}`, email: `p${n}@teste.com`, password: "senha-bem-longa" });
  return { token: r.body.token as string, id: new mongoose.Types.ObjectId(r.body.user.id as string) };
}

/** Grava uma atividade de CrossFit direto, com as métricas já promovidas. */
function fazerWod(
  user: mongoose.Types.ObjectId,
  opts: { slug: string; escala?: string; valor: number; maiorMelhor?: boolean; dias: number }
) {
  return Activity.create({
    user,
    sportId: "crossfit",
    kind: "wod",
    startedAt: new Date(Date.now() - opts.dias * 86_400_000),
    durationSec: 600,
    payload: { v: 3, quadro: "WOD", blocos: [] },
    metrics: {
      wod: {
        slug: opts.slug,
        familia: "girl",
        formato: "for_time",
        escala: opts.escala ?? "rx",
        scoreTipo: opts.maiorMelhor ? "reps" : "tempo",
        scoreValor: opts.valor,
        maiorMelhor: opts.maiorMelhor ?? false,
        capado: false,
      },
    },
  });
}

const benchmarks = (t: string) =>
  request(app).get("/activities/benchmarks").set(auth(t)).then((r) => r.body.data);

describe("Histórico de benchmark", () => {
  it("mostra a melhora entre as duas últimas vezes", async () => {
    const eu = await registrar();
    await fazerWod(eu.id, { slug: "fran", valor: 332, dias: 60 }); // 5:32
    await fazerWod(eu.id, { slug: "fran", valor: 298, dias: 1 }); // 4:58

    const [fran] = await benchmarks(eu.token);

    expect(fran.nome).toBe("Fran");
    expect(fran.vezes).toBe(2);
    expect(fran.melhor.valor).toBe(298);
    // Delta orientado: positivo é melhora, mesmo num score onde MENOR é melhor.
    expect(fran.delta).toBe(34);
  });

  it("piorar dá delta negativo", async () => {
    const eu = await registrar();
    await fazerWod(eu.id, { slug: "grace", valor: 200, dias: 30 });
    await fazerWod(eu.id, { slug: "grace", valor: 230, dias: 1 });

    const [grace] = await benchmarks(eu.token);

    expect(grace.delta).toBe(-30);
    // O melhor continua sendo o melhor, mesmo que a última tenha sido pior.
    expect(grace.melhor.valor).toBe(200);
  });

  it("RX e scaled são progressões separadas", async () => {
    const eu = await registrar();
    await fazerWod(eu.id, { slug: "fran", escala: "scaled", valor: 400, dias: 90 });
    await fazerWod(eu.id, { slug: "fran", escala: "rx", valor: 332, dias: 2 });

    const linhas = await benchmarks(eu.token);

    // Misturar as duas mostraria uma "melhora" que só veio de escalar menos —
    // ou uma "piora" quando a pessoa subiu de nível.
    expect(linhas).toHaveLength(2);
    expect(linhas.map((l: { escala: string }) => l.escala).sort()).toEqual(["rx", "scaled"]);
    expect(linhas.every((l: { delta: number | null }) => l.delta === null)).toBe(true);
  });

  it("uma vez só não tem delta", async () => {
    const eu = await registrar();
    await fazerWod(eu.id, { slug: "helen", valor: 500, dias: 3 });

    const [helen] = await benchmarks(eu.token);

    expect(helen.vezes).toBe(1);
    expect(helen.delta).toBeNull();
    expect(helen.ultimo.valor).toBe(500);
  });

  it("score onde MAIOR é melhor inverte o sinal do delta", async () => {
    const eu = await registrar();
    await fazerWod(eu.id, { slug: "cindy", valor: 200, maiorMelhor: true, dias: 40 });
    await fazerWod(eu.id, { slug: "cindy", valor: 240, maiorMelhor: true, dias: 1 });

    const [cindy] = await benchmarks(eu.token);

    expect(cindy.delta).toBe(40);
    expect(cindy.melhor.valor).toBe(240);
  });

  it("ignora treino sem benchmark", async () => {
    const eu = await registrar();
    await Activity.create({
      user: eu.id,
      sportId: "crossfit",
      kind: "wod",
      startedAt: new Date(),
      payload: { v: 3, quadro: "WOD", blocos: [] },
      metrics: { wod: { slug: null, escala: "rx", scoreValor: 300 } },
    });

    // "WOD do dia" não é benchmark: compararia treinos sem relação.
    expect(await benchmarks(eu.token)).toHaveLength(0);
  });

  it("exige autenticação", async () => {
    expect((await request(app).get("/activities/benchmarks")).status).toBe(401);
  });
});
