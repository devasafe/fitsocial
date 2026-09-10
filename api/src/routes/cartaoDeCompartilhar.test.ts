import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../app.js";
import { Activity } from "../models/Activity.js";

const app = createApp();
let mongod: MongoMemoryServer;

let dono = { token: "", id: "" };
let outro = { token: "", id: "" };

async function registrar(email: string) {
  const r = await request(app)
    .post("/auth/register")
    .send({ name: "Pessoa " + email[0], email, password: "senha-bem-longa" });
  return { token: r.body.token as string, id: r.body.user.id as string };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  dono = await registrar("dono@teste.com");
  outro = await registrar("outro@teste.com");
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function postComCorrida(token: string, userId: string) {
  const atividade = await Activity.create({
    user: new mongoose.Types.ObjectId(userId),
    sportId: "corrida",
    kind: "endurance",
    date: "2026-09-10",
    durationSec: 1650,
    metrics: { distanceKm: 5.2, avgPaceSecPerKm: 318 },
    payload: {
      distanceM: 5200,
      points: Array.from({ length: 50 }, (_, i) => ({
        lat: -23.56 + i * 0.0002,
        lng: -46.65 + Math.sin(i / 8) * 0.001,
      })),
    },
  });

  const r = await request(app)
    .post("/social/posts")
    .set(auth(token))
    .send({ text: "corrida de hoje", activityId: atividade._id.toString() });
  return r.body.post.id as string;
}

describe("Cartao para compartilhar fora do app", () => {
  it("gera um PNG no formato de story, com os numeros do treino", async () => {
    const id = await postComCorrida(dono.token, dono.id);

    const r = await request(app)
      .post(`/social/posts/${id}/cartao?formato=story`)
      .set(auth(dono.token))
      .expect(200);

    expect(r.body.formato).toBe("story");
    expect(r.body.url).toMatch(/\.png$/);

    // O arquivo tem que existir de verdade e ter o tamanho que o Instagram
    // aceita sem recortar.
    const caminho = r.body.url.replace(/^https?:\/\/[^/]+/, "");
    const imagem = await request(app).get(caminho).expect(200);
    const meta = await sharp(imagem.body).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1920);
  });

  it("o formato de feed sai em 4:5", async () => {
    const id = await postComCorrida(dono.token, dono.id);

    const r = await request(app)
      .post(`/social/posts/${id}/cartao?formato=feed`)
      .set(auth(dono.token))
      .expect(200);

    const caminho = r.body.url.replace(/^https?:\/\/[^/]+/, "");
    const meta = await sharp((await request(app).get(caminho)).body).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1350);
  });

  it("so o dono compartilha o proprio post", async () => {
    const id = await postComCorrida(dono.token, dono.id);

    // O cartao leva o nome de quem treinou. Gerar o de outra pessoa seria
    // assinar por ela.
    await request(app)
      .post(`/social/posts/${id}/cartao`)
      .set(auth(outro.token))
      .expect(403);
  });

  it("post sem treino ainda gera cartao, com o texto no lugar do titulo", async () => {
    const criado = await request(app)
      .post("/social/posts")
      .set(auth(dono.token))
      .send({ text: "so um texto, sem treino nenhum" })
      .expect(201);

    await request(app)
      .post(`/social/posts/${criado.body.post.id}/cartao`)
      .set(auth(dono.token))
      .expect(200);
  });

  it("exige autenticacao", async () => {
    const id = await postComCorrida(dono.token, dono.id);
    await request(app).post(`/social/posts/${id}/cartao`).expect(401);
  });
});
