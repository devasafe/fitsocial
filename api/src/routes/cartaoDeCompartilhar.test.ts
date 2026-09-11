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

/** So o caminho: o host vem da requisicao, e o supertest muda de porta. */
const caminhoDe = (url: string) => url.replace(/^https?:\/\/[^/]+/, "");

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

  it("sem foto, qualquer desenho escolhido vira o tipografico", async () => {
    const id = await postComCorrida(dono.token, dono.id);

    // O app manda a preferencia guardada da pessoa; nao ha foto para sobrepor.
    // Responder "foto" faria a previa mostrar um desenho e entregar outro.
    const r = await request(app)
      .post(`/social/posts/${id}/cartao?formato=story&layout=cartao`)
      .set(auth(dono.token))
      .expect(200);

    expect(r.body.layout).toBe("numeros");
  });

  it("layout desconhecido nao derruba o compartilhamento", async () => {
    const id = await postComCorrida(dono.token, dono.id);

    await request(app)
      .post(`/social/posts/${id}/cartao?layout=poster-3d`)
      .set(auth(dono.token))
      .expect(200);
  });

  it("o mesmo pedido devolve o mesmo arquivo", async () => {
    const id = await postComCorrida(dono.token, dono.id);

    // Olhar os tres desenhos antes de escolher e o uso normal. Sem cache, cada
    // olhada deixaria um PNG orfao no storage para sempre.
    const um = await request(app)
      .post(`/social/posts/${id}/cartao?formato=story&layout=ficha`)
      .set(auth(dono.token))
      .expect(200);
    const dois = await request(app)
      .post(`/social/posts/${id}/cartao?formato=story&layout=ficha`)
      .set(auth(dono.token))
      .expect(200);

    // Pelo caminho, e nao pela URL inteira: o supertest sobe numa porta nova a
    // cada chamada, e o host e montado na hora justamente por isso.
    expect(caminhoDe(dois.body.url)).toBe(caminhoDe(um.body.url));

    // Formato diferente e outro desenho: o cache e por par, nao por post.
    const feed = await request(app)
      .post(`/social/posts/${id}/cartao?formato=feed&layout=ficha`)
      .set(auth(dono.token))
      .expect(200);
    expect(caminhoDe(feed.body.url)).not.toBe(caminhoDe(um.body.url));
  });

  it("editar o texto joga fora o cartao ja montado", async () => {
    const criado = await request(app)
      .post("/social/posts")
      .set(auth(dono.token))
      .send({ text: "titulo velho" })
      .expect(201);
    const id = criado.body.post.id as string;

    const antes = await request(app)
      .post(`/social/posts/${id}/cartao`)
      .set(auth(dono.token))
      .expect(200);

    // Em post sem treino o titulo do cartao E o texto: servir o cache aqui
    // mostraria a versao antiga para sempre.
    await request(app)
      .patch(`/social/posts/${id}`)
      .set(auth(dono.token))
      .send({ text: "titulo novo" })
      .expect(200);

    const depois = await request(app)
      .post(`/social/posts/${id}/cartao`)
      .set(auth(dono.token))
      .expect(200);

    expect(caminhoDe(depois.body.url)).not.toBe(caminhoDe(antes.body.url));
  });

  it("treino de crossfit com descanso e dupla nao quebra o cartao", async () => {
    const atividade = await Activity.create({
      user: new mongoose.Types.ObjectId(dono.id),
      sportId: "crossfit",
      kind: "wod",
      date: "2026-09-10",
      durationSec: 900,
      payload: {
        v: 3,
        tamanhoDoTime: 2,
        blocos: [
          {
            modo: "WARM-UP",
            movimentos: [{ nome: "Beat Swing", volume: { valor: 4, unidade: "reps" } }],
            lido: { familia: "livre", versao: 1 },
          },
          { modo: "REST 1'", movimentos: [], lido: { familia: "descanso", versao: 1 } },
          {
            modo: "AMRAP 6'",
            nome: "Relay",
            escala: { nivel: "rx" },
            movimentos: [
              { nome: "Run", volume: { valor: 100, unidade: "metros" }, escopo: "dividido" },
              { nome: "Rope Climb", volume: { valor: 2, unidade: "reps" }, escopo: "cada" },
            ],
            resultado: { tipo: "rounds_reps", rounds: 7, repsExtras: 1 },
          },
        ],
      },
    });

    const criado = await request(app)
      .post("/social/posts")
      .set(auth(dono.token))
      .send({ text: "relay de hoje", activityId: atividade._id.toString() })
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
