import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../app.js";
import { Activity } from "../models/Activity.js";
import { Post } from "../models/Post.js";

// O cartão para o Story sem passar por publicar no feed.
//
// O caminho antigo exigia um Post: quem não quisesse publicar dentro do app
// simplesmente não gerava cartão nenhum — e publicar no Instagram é o que a
// pessoa faz com a audiência que ela JÁ tem, enquanto o feed interno depende de
// um app cheio. Eram duas decisões amarradas numa só.

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
  dono = await registrar("dona@teste.com");
  outro = await registrar("outra@teste.com");
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const caminhoDe = (url: string) => url.replace(/^https?:\/\/[^/]+/, "");

async function corridaDe(userId: string) {
  return Activity.create({
    user: new mongoose.Types.ObjectId(userId),
    sportId: "corrida",
    kind: "endurance",
    durationSec: 1650,
    metrics: { distanceKm: 5.2, avgPaceSecPerKm: 318 },
    payload: { distanceM: 5200 },
  });
}

describe("POST /social/activities/:id/cartao", () => {
  it("monta o cartão do treino sem exigir que ele tenha virado post", async () => {
    const treino = await corridaDe(dono.id);

    const r = await request(app)
      .post(`/social/activities/${treino._id}/cartao`)
      .set(auth(dono.token));

    expect(r.status).toBe(200);
    expect(r.body.url).toBeTruthy();
    expect(await Post.countDocuments({})).toBe(0);

    const img = await request(app).get(caminhoDe(r.body.url as string));
    expect(img.status).toBe(200);
    const meta = await sharp(img.body).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1920);
  });

  it("reaproveita o cartão já montado em vez de deixar PNG órfão", async () => {
    const treino = await corridaDe(dono.id);

    const um = await request(app).post(`/social/activities/${treino._id}/cartao`).set(auth(dono.token));
    const dois = await request(app).post(`/social/activities/${treino._id}/cartao`).set(auth(dono.token));

    // Pelo CAMINHO, e não pela URL inteira: o supertest sobe numa porta
    // efêmera diferente a cada requisição, e `toAbsoluto` monta o host a partir
    // dela — duas URLs diferentes apontando para o mesmo arquivo.
    expect(caminhoDe(um.body.url as string)).toBe(caminhoDe(dois.body.url as string));
  });

  it("recusa montar o cartão do treino de outra pessoa", async () => {
    const treino = await corridaDe(dono.id);

    const r = await request(app)
      .post(`/social/activities/${treino._id}/cartao`)
      .set(auth(outro.token));

    expect(r.status).toBe(403);
  });

  it("responde 404 para treino que não existe", async () => {
    const r = await request(app)
      .post(`/social/activities/${new mongoose.Types.ObjectId()}/cartao`)
      .set(auth(dono.token));

    expect(r.status).toBe(404);
  });

  it("exige autenticação", async () => {
    const treino = await corridaDe(dono.id);
    const r = await request(app).post(`/social/activities/${treino._id}/cartao`);
    expect(r.status).toBe(401);
  });
});
