import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Post } from "../models/Post.js";
import { Follow } from "../models/Follow.js";
import { Challenge } from "../models/Challenge.js";
import { ChallengeMember } from "../models/ChallengeMember.js";
import { Notification } from "../models/Notification.js";
import { ReadState } from "../models/ReadState.js";

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
    Post.deleteMany({}),
    Follow.deleteMany({}),
    Challenge.deleteMany({}),
    ChallengeMember.deleteMany({}),
    Notification.deleteMany({}),
    ReadState.deleteMany({}),
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

const contadores = (token: string) =>
  request(app).get("/read-state").set(auth(token)).then((r) => r.body.data);

const marcar = (token: string, area: string) =>
  request(app).post(`/read-state/${area}`).set(auth(token));

function post(author: mongoose.Types.ObjectId, extra: Record<string, unknown> = {}) {
  return Post.create({ author, text: "treinei", ...extra });
}

function desafio(creator: mongoose.Types.ObjectId, extra: Record<string, unknown> = {}) {
  const amanha = new Date(Date.now() + 86_400_000);
  return Challenge.create({
    creator,
    name: "Desafio",
    startAt: new Date(),
    endAt: amanha,
    joinCode: `C${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    scoreMode: "checkins",
    visibility: "public",
    ...extra,
  });
}

describe("Contadores de conteúdo novo", () => {
  it("começa zerado — o que existia antes de você olhar não é novidade", async () => {
    const outro = await registrar();
    await post(outro.id);
    await desafio(outro.id);

    // Quem chega depois não devia abrir o app com "99+" em tudo.
    const eu = await registrar();
    await Follow.create({ follower: eu.id, following: outro.id });

    expect(await contadores(eu.token)).toEqual({
      feed: 0,
      explore: 0,
      desafios: 0,
      notificacoes: 0,
    });
  });

  it("conta o que veio depois da marca", async () => {
    const eu = await registrar();
    const seguido = await registrar();
    await Follow.create({ follower: eu.id, following: seguido.id });
    await contadores(eu.token); // fixa a marca em "agora"

    await post(seguido.id);
    await post(seguido.id);

    expect((await contadores(eu.token)).feed).toBe(2);
  });

  it("não conta o próprio post como novidade", async () => {
    const eu = await registrar();
    await contadores(eu.token);

    await post(eu.id);

    const c = await contadores(eu.token);
    expect(c.feed).toBe(0);
    expect(c.explore).toBe(0);
  });

  it("Explorar conta só quem eu não sigo — os mesmos posts não valem em dobro", async () => {
    const eu = await registrar();
    const seguido = await registrar();
    const estranho = await registrar();
    await Follow.create({ follower: eu.id, following: seguido.id });
    await contadores(eu.token);

    await post(seguido.id);
    await post(estranho.id);

    const c = await contadores(eu.token);
    // Se Explorar contasse todo mundo, daria feed 1 + explore 2 = três
    // novidades para dois posts.
    expect(c.feed).toBe(1);
    expect(c.explore).toBe(1);
  });

  it("ignora post escondido pela moderação e post excluído", async () => {
    const eu = await registrar();
    const outro = await registrar();
    await contadores(eu.token);

    await post(outro.id, { hidden: true });
    await post(outro.id, { deletedAt: new Date() });

    expect((await contadores(eu.token)).explore).toBe(0);
  });

  it("marcar uma área não mexe nas outras", async () => {
    const eu = await registrar();
    const outro = await registrar();
    await Follow.create({ follower: eu.id, following: outro.id });
    await contadores(eu.token);

    await post(outro.id);
    await desafio(outro.id);

    const depois = (await marcar(eu.token, "feed")).body.data;
    expect(depois.feed).toBe(0);
    expect(depois.desafios).toBe(1); // continua pedindo atenção
  });

  it("recusa área inventada", async () => {
    const eu = await registrar();
    const r = await marcar(eu.token, "inbox");
    expect(r.status).toBe(400);
  });

  it("marcar duas vezes seguidas não quebra nem duplica a linha", async () => {
    const eu = await registrar();
    await marcar(eu.token, "feed").expect(200);
    await marcar(eu.token, "feed").expect(200);

    expect(await ReadState.countDocuments({ user: eu.id, area: "feed" })).toBe(1);
  });

  it("conta desafio público novo, mas não o que eu criei nem o que eu já entrei", async () => {
    const eu = await registrar();
    const outro = await registrar();
    await contadores(eu.token);

    const meu = await desafio(eu.id);
    const alheio = await desafio(outro.id);
    const jaEntrei = await desafio(outro.id);
    await ChallengeMember.create({ challenge: jaEntrei._id, user: eu.id });
    void meu;

    expect((await contadores(eu.token)).desafios).toBe(1);
    expect(alheio.visibility).toBe("public");
  });

  it("não conta desafio que já terminou nem desafio por código", async () => {
    const eu = await registrar();
    const outro = await registrar();
    await contadores(eu.token);

    const ontem = new Date(Date.now() - 86_400_000);
    await desafio(outro.id, { startAt: new Date(Date.now() - 172_800_000), endAt: ontem });
    await desafio(outro.id, { visibility: "code" });

    expect((await contadores(eu.token)).desafios).toBe(0);
  });

  it("notificação usa o próprio `read`, não a marca d'água", async () => {
    const eu = await registrar();
    const outro = await registrar();
    await Notification.create({
      user: eu.id,
      type: "like",
      actor: outro.id,
      text: "curtiu seu post",
    });

    expect((await contadores(eu.token)).notificacoes).toBe(1);

    // Marcar o feed como visto não pode apagar a notificação não lida.
    const depois = (await marcar(eu.token, "feed")).body.data;
    expect(depois.notificacoes).toBe(1);

    await request(app).post("/notifications/read").set(auth(eu.token));
    expect((await contadores(eu.token)).notificacoes).toBe(0);
  });

  it("para de contar no teto em vez de varrer tudo", async () => {
    const eu = await registrar();
    const outro = await registrar();
    await contadores(eu.token);

    await Post.insertMany(
      Array.from({ length: 105 }, () => ({ author: outro.id, text: "spam" }))
    );

    expect((await contadores(eu.token)).explore).toBe(100); // 99 + 1, o app mostra "99+"
  });

  it("duas chamadas ao mesmo tempo não duplicam a marca nem falham", async () => {
    const eu = await registrar();

    // Duas abas abertas, ou o app pedindo ao voltar do background enquanto a
    // tela também pede: as duas criam a marca inicial na mesma hora.
    const [a, b] = await Promise.all([contadores(eu.token), contadores(eu.token)]);

    expect(a).toEqual(b);
    expect(await ReadState.countDocuments({ user: eu.id })).toBe(3);
  });

  it("exige autenticação", async () => {
    expect((await request(app).get("/read-state")).status).toBe(401);
    expect((await request(app).post("/read-state/feed")).status).toBe(401);
  });
});
