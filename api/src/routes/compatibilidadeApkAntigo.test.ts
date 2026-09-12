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
