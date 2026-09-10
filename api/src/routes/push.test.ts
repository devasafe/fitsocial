import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Post } from "../models/Post.js";
import { Follow } from "../models/Follow.js";
import { ReadState } from "../models/ReadState.js";
import { PushDevice, PushCooldown } from "../models/PushDevice.js";
import { enviarPush, avisarSeguidoresDePost } from "../services/push/index.js";

// O transporte é o limite do que este teste cobre: a partir daqui o Expo é
// problema do Expo. O que importa provar é QUEM recebe e QUANDO.
const enviados: { to: string; title: string; body: string }[] = [];
let invalidos: string[] = [];

vi.mock("../services/push/expo.js", () => ({
  enviarParaExpo: vi.fn(async (mensagens: { to: string; title: string; body: string }[]) => {
    const bons = mensagens.filter((m) => !invalidos.includes(m.to));
    enviados.push(...bons);
    return { entregues: bons.length, invalidos: mensagens.filter((m) => invalidos.includes(m.to)).map((m) => m.to) };
  }),
}));

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
    ReadState.deleteMany({}),
    PushDevice.deleteMany({}),
    PushCooldown.deleteMany({}),
  ]);
  enviados.length = 0;
  invalidos = [];
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let n = 0;
async function registrar(nome?: string) {
  n += 1;
  const r = await request(app)
    .post("/auth/register")
    .send({ name: nome ?? `Pessoa ${n}`, email: `p${n}@teste.com`, password: "senha-bem-longa" });
  return {
    token: r.body.token as string,
    id: new mongoose.Types.ObjectId(r.body.user.id as string),
    nome: r.body.user.name as string,
  };
}

const registrarAparelho = (token: string, push = `ExpoPushToken[${Math.random()}]`) =>
  request(app).post("/push/devices").set(auth(token)).send({ token: push, platform: "android" });

async function comAparelho(nome?: string) {
  const u = await registrar(nome);
  const push = `ExpoPushToken[${u.id}]`;
  await registrarAparelho(u.token, push).expect(201);
  return { ...u, push };
}

describe("Registro do aparelho", () => {
  it("registra e para de mandar quando o aparelho sai", async () => {
    const u = await comAparelho();
    expect(await PushDevice.countDocuments({ user: u.id })).toBe(1);

    await request(app)
      .delete("/push/devices")
      .set(auth(u.token))
      .send({ token: u.push })
      .expect(200);

    expect(await PushDevice.countDocuments({ user: u.id })).toBe(0);
  });

  it("registrar duas vezes o mesmo aparelho não cria dois", async () => {
    const u = await registrar();
    await registrarAparelho(u.token, "ExpoPushToken[fixo]").expect(201);
    await registrarAparelho(u.token, "ExpoPushToken[fixo]").expect(201);

    expect(await PushDevice.countDocuments({})).toBe(1);
  });

  it("o aparelho muda de dono quando outra pessoa entra nele", async () => {
    const antigo = await registrar("Dono Antigo");
    const novo = await registrar("Dono Novo");
    await registrarAparelho(antigo.token, "ExpoPushToken[celular]");

    await registrarAparelho(novo.token, "ExpoPushToken[celular]").expect(201);

    // Se o registro ficasse com os dois, quem vendeu o celular continuaria
    // mandando as próprias notificações para o novo dono.
    expect(await PushDevice.countDocuments({})).toBe(1);
    expect(await PushDevice.countDocuments({ user: novo.id })).toBe(1);
  });

  it("não deixa remover o registro de outra pessoa", async () => {
    const dono = await comAparelho();
    const estranho = await registrar();

    const r = await request(app)
      .delete("/push/devices")
      .set(auth(estranho.token))
      .send({ token: dono.push });

    expect(r.body.data.removido).toBe(false);
    expect(await PushDevice.countDocuments({})).toBe(1);
  });

  it("exige autenticação", async () => {
    expect((await request(app).post("/push/devices").send({ token: "x".repeat(20), platform: "ios" })).status).toBe(401);
  });
});

describe("O que interrompe e o que não interrompe", () => {
  it("comentário no seu post vira push", async () => {
    const dono = await comAparelho("Dono");
    const post = (await request(app).post("/social/posts").set(auth(dono.token)).send({ text: "treino" })).body.post;
    const ana = await registrar("Ana");

    await request(app)
      .post(`/social/posts/${post.id}/comments`)
      .set(auth(ana.token))
      .send({ text: "boa demais, qual foi a carga?" });

    await vi.waitFor(() => expect(enviados).toHaveLength(1));
    expect(enviados[0].title).toBe("Ana comentou no seu post");
    expect(enviados[0].body).toBe("boa demais, qual foi a carga?");
  });

  it("curtida NÃO vira push", async () => {
    const dono = await comAparelho("Dono");
    const post = (await request(app).post("/social/posts").set(auth(dono.token)).send({ text: "treino" })).body.post;
    const ana = await registrar("Ana");

    await request(app).post(`/social/posts/${post.id}/like`).set(auth(ana.token)).expect(200);

    // É o evento mais frequente e o menos acionável: é por ele que as pessoas
    // desligam tudo e nunca mais voltam.
    await new Promise((r) => setTimeout(r, 150));
    expect(enviados).toHaveLength(0);
  });

  it("comentar no próprio post não te acorda", async () => {
    const dono = await comAparelho("Dono");
    const post = (await request(app).post("/social/posts").set(auth(dono.token)).send({ text: "treino" })).body.post;

    await request(app)
      .post(`/social/posts/${post.id}/comments`)
      .set(auth(dono.token))
      .send({ text: "comigo mesmo" });

    await new Promise((r) => setTimeout(r, 150));
    expect(enviados).toHaveLength(0);
  });

  it("interações desligadas silenciam o push do comentário", async () => {
    const dono = await comAparelho("Dono");
    await request(app)
      .patch("/auth/settings")
      .set(auth(dono.token))
      .send({ notificacoes: { interacoes: false } })
      .expect(200);
    const post = (await request(app).post("/social/posts").set(auth(dono.token)).send({ text: "t" })).body.post;
    const ana = await registrar("Ana");

    await request(app).post(`/social/posts/${post.id}/comments`).set(auth(ana.token)).send({ text: "oi" });

    await new Promise((r) => setTimeout(r, 150));
    expect(enviados).toHaveLength(0);
  });
});

describe("Quem você segue publicou", () => {
  it("avisa os seguidores uma vez, e cala na segunda publicação", async () => {
    const autor = await registrar("Autor");
    const seguidor = await comAparelho("Seguidor");
    await Follow.create({ follower: seguidor.id, following: autor.id });

    expect(await avisarSeguidoresDePost(autor.id, autor.nome)).toBe(1);
    // Segunda publicação na mesma janela: o badge cobre, o celular não toca.
    expect(await avisarSeguidoresDePost(autor.id, autor.nome)).toBe(0);
    expect(enviados).toHaveLength(1);
  });

  it("quem não segue não recebe", async () => {
    const autor = await registrar("Autor");
    await comAparelho("Estranho");

    expect(await avisarSeguidoresDePost(autor.id, autor.nome)).toBe(0);
  });

  it("com várias publicações não vistas, o texto vira o número", async () => {
    const autor = await registrar("Autor");
    const seguidor = await comAparelho("Seguidor");
    await Follow.create({ follower: seguidor.id, following: autor.id });
    // A marca de leitura precisa existir: é ela que define "não visto".
    await request(app).get("/read-state").set(auth(seguidor.token));

    await Post.create({ author: autor.id, text: "um" });
    await Post.create({ author: autor.id, text: "dois" });
    await Post.create({ author: autor.id, text: "três" });

    await avisarSeguidoresDePost(autor.id, autor.nome);

    expect(enviados[0].body).toBe("3 publicações novas de quem você segue");
  });

  it("novos posts desligado: nem push, nem badge", async () => {
    const autor = await registrar("Autor");
    const seguidor = await comAparelho("Seguidor");
    await Follow.create({ follower: seguidor.id, following: autor.id });
    await request(app)
      .patch("/auth/settings")
      .set(auth(seguidor.token))
      .send({ notificacoes: { novosPosts: false } })
      .expect(200);

    expect(await avisarSeguidoresDePost(autor.id, autor.nome)).toBe(0);
  });

  it("a janela não é gravada quando nada foi entregue", async () => {
    const autor = await registrar("Autor");
    const seguidor = await registrar("Sem Aparelho");
    await Follow.create({ follower: seguidor.id, following: autor.id });

    await avisarSeguidoresDePost(autor.id, autor.nome);

    // Marcar um envio que não aconteceu calaria o primeiro push de verdade,
    // logo depois de a pessoa registrar o aparelho.
    expect(await PushCooldown.countDocuments({ user: seguidor.id })).toBe(0);
  });
});

describe("Token que morreu", () => {
  it("aparelho recusado pelo serviço é removido do banco", async () => {
    const dono = await comAparelho("Dono");
    invalidos = [dono.push];

    await enviarPush(dono.id, "comment", { title: "oi", body: "tudo bem?" });

    // Insistir num token morto é desperdício garantido — e o Expo pune quem
    // insiste.
    expect(await PushDevice.countDocuments({ user: dono.id })).toBe(0);
  });
});
