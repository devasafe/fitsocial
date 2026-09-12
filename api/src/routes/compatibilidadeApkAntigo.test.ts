import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Activity } from "../models/Activity.js";
import { PersonalRecord } from "../models/PersonalRecord.js";
import { Plan } from "../models/Plan.js";
import { Post } from "../models/Post.js";

// Cada teste aqui defende uma regra que JÁ QUEBROU uma vez, em produção.
//
// O arquivo nasceu defendendo o APK 1.2.0, que mandava e lia o formato antigo
// de WOD. Essa compatibilidade foi abandonada em 11/09/2026 — de propósito, com
// os treinos antigos apagados junto. O que sobrou aqui não é sobre versão de
// app: são regras de recorde que eu já quebrei sem querer e que ninguém vê
// quebrar, porque elas falham em silêncio no histórico de quem treina.

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
  await Promise.all([
    User.deleteMany({}),
    Activity.deleteMany({}),
    PersonalRecord.deleteMany({}),
    Plan.deleteMany({}),
    // Sem isto, um post de um teste sobrevive ao autor e ao treino que o teste
    // seguinte apaga, e o feed quebra no teste errado — foi o que aconteceu.
    Post.deleteMany({}),
  ]);
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

/** Um WOD de nome livre — o caso de quase todo mundo que registra. */
function corpoDeWod(
  over: {
    nome?: string;
    modo?: string;
    nivel?: string;
    resultado?: Record<string, unknown>;
  } = {}
) {
  return {
    sportId: "crossfit",
    kind: "wod",
    payload: {
      v: 3,
      blocos: [
        {
          modo: over.modo ?? "FOR TIME",
          nome: over.nome ?? "Treino A",
          movimentos: [
            { nome: "Thruster", volume: { valor: 21, unidade: "reps" }, escopo: "individual" },
          ],
          resultado: over.resultado ?? { tipo: "tempo", tempoSec: 300 },
          escala: { nivel: over.nivel ?? "rx" },
        },
      ],
    },
  };
}

const registrarWod = (t: string, corpo: Record<string, unknown>) =>
  request(app).post("/activities").set(auth(t)).send(corpo);

const prs = (user: mongoose.Types.ObjectId) => PersonalRecord.find({ user }).lean();

describe("Regras de recorde que ja quebraram", () => {
  it("WOD com nome livre AINDA gera recorde", async () => {
    const u = await registrar();
    await registrarWod(u.token, corpoDeWod({ resultado: { tipo: "tempo", tempoSec: 300 } }));
    await registrarWod(u.token, corpoDeWod({ resultado: { tipo: "tempo", tempoSec: 280 } }));

    // Eu tinha passado a exigir benchmark do catálogo, e isso parou de atualizar
    // o recorde de quem chama o WOD de "Treino A" — silenciosamente.
    const lista = await prs(u.id);
    const wod = lista.find((p) => p.type === "wod_time");
    expect(wod).toBeDefined();
    expect(wod!.value).toBe(280);
  });

  it("AMRAP grava o recorde em ROUNDS, como sempre gravou", async () => {
    const u = await registrar();
    await registrarWod(
      u.token,
      corpoDeWod({ modo: "AMRAP 20'", resultado: { tipo: "rounds_reps", rounds: 15 } })
    );

    const wod = (await prs(u.id)).find((p) => p.type === "wod_score");
    // Eu tinha trocado para o total de reps sob a MESMA chave: um "15 rounds"
    // já gravado viraria alvo de um "150 reps" e celebraria recorde falso.
    expect(wod?.unit).toBe("rounds");
    expect(wod?.value).toBe(15);
  });

  it('nível "adaptado" mantém a chave que já está gravada', async () => {
    const u = await registrar();
    await registrarWod(u.token, corpoDeWod({ nivel: "adaptado" }));

    const wod = (await prs(u.id)).find((p) => p.type === "wod_time");
    // Converter para "custom" criaria um recorde novo ao lado do antigo, e a
    // pessoa veria duplicata.
    expect(wod?.repRange).toBe("adaptado");
  });


  it("post sem dimensao de imagem continua sendo criado e servido", async () => {
    const u = await registrar();

    // O APK antigo manda só imageUrl. Se o servidor passasse a exigir tamanho,
    // publicar foto pararia de funcionar para quem não atualiza.
    const criado = await request(app)
      .post("/social/posts")
      .set(auth(u.token))
      .send({ text: "foto sem tamanho", imageUrl: "https://exemplo.com/f.jpg" })
      .expect(201);

    expect(criado.body.post.imageWidth).toBeNull();
    expect(criado.body.post.imageHeight).toBeNull();

    const feed = await request(app).get("/social/feed").set(auth(u.token)).expect(200);
    expect(feed.body.posts[0].imageUrl).toBe("https://exemplo.com/f.jpg");
  });

  it("plano sem treino devolve forma VAZIA, nunca null", async () => {
    const u = await registrar();
    await Plan.create({
      user: u.id,
      version: 1,
      summary: "só dieta",
      workout: null,
      diet: { dailyCalories: 2000, macros: { proteinG: 1, carbsG: 1, fatG: 1 }, meals: [], notes: "" },
      disclaimer: "d",
    });

    const r = await request(app).get("/plans/current").set(auth(u.token)).expect(200);

    // O app antigo faz `plan.workout.sessions.map(...)` sem guarda: null fecha
    // o app na abertura, e o sintoma não aponta para a causa.
    expect(r.body.plan.workout).not.toBeNull();
    expect(r.body.plan.workout.sessions).toEqual([]);
  });

  it("o resumo do treino no feed mantém a FORMA que o app desenha", async () => {
    const u = await registrar();

    // O card do app lê três campos e só: um título de texto, uma lista de
    // números já escritos, e uma lista de linhas (ou nada). Mudar o CONTEÚDO é
    // o trabalho; mudar a FORMA quebra o app instalado em silêncio — um número
    // onde ele espera string, um objeto onde ele espera linha pronta.
    const criado = await request(app)
      .post("/activities")
      .set(auth(u.token))
      .send({
        sportId: "musculacao",
        kind: "strength",
        durationSec: 1800,
        payload: {
          variant: "musculacao",
          exercises: [
            { name: "Supino reto", sets: [{ type: "valida", weightKg: 80, reps: 8, done: true }] },
          ],
        },
        shareToFeed: true,
      })
      .expect(201);
    expect(criado.body.data.id).toBeTruthy();

    const feed = await request(app).get("/social/feed").set(auth(u.token)).expect(200);
    const resumo = feed.body.posts[0].activity;

    expect(typeof resumo.title).toBe("string");
    expect(resumo.title.length).toBeGreaterThan(0);

    expect(Array.isArray(resumo.stats)).toBe(true);
    for (const linha of resumo.stats) expect(typeof linha).toBe("string");

    // Lista de linhas prontas ou null — nunca objeto, nunca undefined.
    expect(resumo.movements === null || Array.isArray(resumo.movements)).toBe(true);
    for (const linha of resumo.movements ?? []) expect(typeof linha).toBe("string");
  });

  it("exercício sem séries no banco não derruba o feed inteiro", async () => {
    const u = await registrar();

    // O payload é `Mixed`: o que está gravado não passou pelo zod de hoje.
    // Agora que o feed LISTA os exercícios de força, um exercício torto deixaria
    // todo mundo sem feed, não só o dono do treino.
    await Activity.create({
      user: u.id,
      sportId: "musculacao",
      kind: "strength",
      durationSec: 600,
      visibility: "public",
      payload: { variant: "musculacao", exercises: [{ name: "Supino reto" }] },
      metrics: {},
    });

    const feed = await request(app).get("/social/explore").set(auth(u.token));
    expect(feed.status).toBe(200);
  });
});

// A janela entre o deploy e o backfill dos slugs (12/09/2026).
//
// O motor passou a procurar o recorde por `exerciseSlug`. Quem já tinha
// recorde gravado não tinha esse campo: o motor não achava, concluía que era a
// primeira vez, e tentava CRIAR um segundo documento — que batia no índice
// único ANTIGO, ainda vivo na coleção (autoIndex cria índice, nunca derruba).
//
// O resultado era o pior tipo de erro: a atividade já estava gravada e a
// resposta era 500. A pessoa via "não foi possível salvar", tentava de novo, e
// duplicava o treino a cada tentativa.
describe("Recorde antigo, sem slug, no intervalo até o backfill", () => {
  /** Deixa a coleção exatamente como está em produção hoje. */
  async function comoEstaEmProducao(userId: string) {
    await PersonalRecord.collection
      .dropIndex("user_1_exerciseSlug_1_type_1_repRange_1")
      .catch(() => undefined);
    await PersonalRecord.collection.createIndex(
      { user: 1, exerciseName: 1, type: 1, repRange: 1 },
      { unique: true, name: "user_1_exerciseName_1_type_1_repRange_1" }
    );
    // Gravado pelo driver: o schema de hoje poria `exerciseSlug: ""`.
    await PersonalRecord.collection.insertOne({
      user: new mongoose.Types.ObjectId(userId),
      sportId: "musculacao",
      exerciseName: "Supino reto",
      type: "carga_max",
      repRange: null,
      value: 80,
      unit: "kg",
      achievedAt: new Date("2026-09-01"),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async function registrarSupino(token: string, weightKg: number) {
    return request(app)
      .post("/activities")
      .set(auth(token))
      .send({
        sportId: "musculacao",
        kind: "strength",
        startedAt: new Date().toISOString(),
        payload: {
          variant: "musculacao",
          exercises: [
            { name: "Supino reto", sets: [{ type: "valida", weightKg, reps: 5, done: true }] },
          ],
        },
      });
  }

  it("registrar treino continua funcionando, e o recorde é superado, não duplicado", async () => {
    const reg = await request(app)
      .post("/auth/register")
      .send({ name: "Danilo", email: "danilo@teste.com", password: "senha-bem-longa" });
    await comoEstaEmProducao(reg.body.user.id);

    const r = await registrarSupino(reg.body.token, 90);

    expect(r.status).toBe(201);
    const prs = await PersonalRecord.find({ user: reg.body.user.id, type: "carga_max" });
    expect(prs).toHaveLength(1);
    expect(prs[0].value).toBe(90);
    expect(prs[0].previousValue).toBe(80);
    // E o documento antigo ganhou a identidade: cada pessoa migra ao treinar.
    expect(prs[0].exerciseSlug).toBe("supino_reto");
  });

  it("e o recorde superado é celebrado, como sempre foi", async () => {
    const reg = await request(app)
      .post("/auth/register")
      .send({ name: "Viana", email: "viana@teste.com", password: "senha-bem-longa" });
    await comoEstaEmProducao(reg.body.user.id);

    const r = await registrarSupino(reg.body.token, 95);

    expect(r.body.meta.newPRs.some((p: { type: string }) => p.type === "carga_max")).toBe(true);
  });

  // O treino é gravado ANTES de o recorde ser calculado. Se o motor falhar, a
  // pessoa não pode receber "não salvou" por um treino que está salvo — ela
  // tentaria de novo e duplicaria o histórico.
  it("uma falha no motor de recorde não derruba o salvamento do treino", async () => {
    const reg = await request(app)
      .post("/auth/register")
      .send({ name: "Fabio", email: "fabio@teste.com", password: "senha-bem-longa" });

    // Substitui o método para simular o banco caindo no meio do salvamento.
    const original = PersonalRecord.findOne;
    PersonalRecord.findOne = (() => {
      throw new Error("banco fora do ar no meio do salvamento");
    }) as typeof PersonalRecord.findOne;

    try {
      const r = await registrarSupino(reg.body.token, 100);
      expect(r.status).toBe(201);
      expect(r.body.meta.newPRs).toEqual([]);
      expect(await Activity.countDocuments({ user: reg.body.user.id })).toBe(1);
    } finally {
      PersonalRecord.findOne = original;
    }
  });
});
