import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Post } from "../models/Post.js";
import { Notification } from "../models/Notification.js";
import { Report } from "../models/Report.js";
import { Follow } from "../models/Follow.js";
import { ReadState } from "../models/ReadState.js";
import { grantAdmin } from "../scripts/grantAdmin.js";

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
    Notification.deleteMany({}),
    Report.deleteMany({}),
    Follow.deleteMany({}),
    ReadState.deleteMany({}),
  ]);
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

let ipSeq = 0;

/** O painel tem sessão própria: papel de admin não basta, precisa entrar por lá. */
async function admin() {
  n += 1;
  const email = `mod${n}@teste.com`;
  const r = await request(app)
    .post("/auth/register")
    .send({ name: "Moderação", email, password: "senha-bem-longa" });
  await grantAdmin(email, { force: true });
  const sessao = await request(app)
    .post("/admin/session")
    .set("X-Forwarded-For", `198.51.100.${++ipSeq}`)
    .send({ email, password: "senha-bem-longa" });
  return {
    token: r.body.token as string,
    painel: sessao.body.data.token as string,
    id: new mongoose.Types.ObjectId(r.body.user.id as string),
  };
}

const publicar = (token: string, texto = "treino de hoje") =>
  request(app).post("/social/posts").set(auth(token)).send({ text: texto });

const curtir = (token: string, postId: string) =>
  request(app).post(`/social/posts/${postId}/like`).set(auth(token));

const comentar = (token: string, postId: string, texto: string) =>
  request(app).post(`/social/posts/${postId}/comments`).set(auth(token)).send({ text: texto });

const listar = (token: string) =>
  request(app).get("/notifications").set(auth(token)).then((r) => r.body);

const desligar = (token: string, chave: string) =>
  request(app)
    .patch("/auth/settings")
    .set(auth(token))
    .send({ notificacoes: { [chave]: false } });

describe("Agrupar em vez de empilhar", () => {
  it("três pessoas curtindo o mesmo post viram uma linha só", async () => {
    const dono = await registrar("Dono");
    const post = (await publicar(dono.token)).body.post;
    const a = await registrar("Ana");
    const b = await registrar("Bruno");
    const c = await registrar("Carla");

    await curtir(a.token, post.id);
    await curtir(b.token, post.id);
    await curtir(c.token, post.id);

    const { data, unread } = await listar(dono.token);
    expect(data).toHaveLength(1);
    expect(unread).toBe(1);
    expect(data[0].text).toBe("Carla e mais 2 curtiram seu post");
    expect(data[0].pessoas).toBe(3);
  });

  it("a MESMA pessoa comentando três vezes continua sendo uma pessoa", async () => {
    const dono = await registrar("Dono");
    const post = (await publicar(dono.token)).body.post;
    const ana = await registrar("Ana");

    await comentar(ana.token, post.id, "primeiro");
    await comentar(ana.token, post.id, "segundo");
    await comentar(ana.token, post.id, "terceiro");

    const { data } = await listar(dono.token);
    expect(data).toHaveLength(1);
    // Contar eventos diria "Ana e mais 2", que é uma mentira sobre quantas
    // pessoas estão falando com você.
    expect(data[0].text).toBe("Ana comentou no seu post");
    expect(data[0].pessoas).toBe(1);
  });

  it("curtida e comentário no mesmo post são assuntos diferentes", async () => {
    const dono = await registrar("Dono");
    const post = (await publicar(dono.token)).body.post;
    const ana = await registrar("Ana");

    await curtir(ana.token, post.id);
    await comentar(ana.token, post.id, "boa!");

    const { data } = await listar(dono.token);
    expect(data).toHaveLength(2);
  });

  it("depois de lida, a curtida seguinte é notícia de novo", async () => {
    const dono = await registrar("Dono");
    const post = (await publicar(dono.token)).body.post;
    const a = await registrar("Ana");
    const b = await registrar("Bruno");

    await curtir(a.token, post.id);
    await request(app).post("/notifications/read").set(auth(dono.token));
    await curtir(b.token, post.id);

    const { data, unread } = await listar(dono.token);
    expect(data).toHaveLength(2);
    expect(unread).toBe(1);
  });

  it("o assunto que acabou de receber algo volta para o topo", async () => {
    const dono = await registrar("Dono");
    const antigo = (await publicar(dono.token, "post antigo")).body.post;
    const novo = (await publicar(dono.token, "post novo")).body.post;
    const ana = await registrar("Ana");
    const bruno = await registrar("Bruno");

    await curtir(ana.token, antigo.id);
    await curtir(ana.token, novo.id);
    // O assunto mais velho recebe gente nova: é o que está acontecendo agora.
    await curtir(bruno.token, antigo.id);

    const { data } = await listar(dono.token);
    expect(data[0].targetId).toBe(antigo.id);
  });
});

describe("A preferência é conferida antes de gravar", () => {
  it("interações desligadas: a curtida não vira notificação nenhuma", async () => {
    const dono = await registrar("Dono");
    const post = (await publicar(dono.token)).body.post;
    await desligar(dono.token, "interacoes").expect(200);
    const ana = await registrar("Ana");

    await curtir(ana.token, post.id);

    // Nem escondida: se ficasse gravada, religar a chave despejaria semanas de
    // acúmulo de uma vez.
    expect(await Notification.countDocuments({ user: dono.id })).toBe(0);
  });

  it("interações desligadas não silenciam a moderação", async () => {
    const dono = await registrar("Dono");
    const post = (await publicar(dono.token)).body.post;
    await desligar(dono.token, "interacoes");
    await desligar(dono.token, "sistema");
    const mod = await admin();

    await request(app).delete(`/social/posts/${post.id}`).set(auth(mod.token)).expect(200);

    const { data } = await listar(dono.token);
    expect(data).toHaveLength(1);
    expect(data[0].type).toBe("post_removido");
  });

  it("desligar novos posts apaga o badge do Feed, e só ele", async () => {
    const eu = await registrar();
    const seguido = await registrar();
    const estranho = await registrar();
    await Follow.create({ follower: eu.id, following: seguido.id });
    await request(app).get("/read-state").set(auth(eu.token));

    await publicar(seguido.token);
    await publicar(estranho.token);
    const antes = (await request(app).get("/read-state").set(auth(eu.token))).body.data;
    expect(antes.feed).toBe(1);
    expect(antes.explore).toBe(1);

    await desligar(eu.token, "novosPosts").expect(200);

    const depois = (await request(app).get("/read-state").set(auth(eu.token))).body.data;
    // A chave promete silêncio sobre quem você segue; o badge do Feed é
    // exatamente esse aviso.
    expect(depois.feed).toBe(0);
    // Descoberta não é a mesma coisa: ninguém pediu silêncio sobre gente nova.
    expect(depois.explore).toBe(1);
  });
});

describe("Avisos da moderação", () => {
  it("quem teve o post removido é avisado, sem saber por quem", async () => {
    const dono = await registrar("Dono");
    const post = (await publicar(dono.token)).body.post;
    const mod = await admin();

    await request(app).delete(`/social/posts/${post.id}`).set(auth(mod.token)).expect(200);

    const { data } = await listar(dono.token);
    expect(data).toHaveLength(1);
    expect(data[0].text).toMatch(/removida/i);
    // Dizer qual administrador decidiu vira briga com uma pessoa em vez de
    // decisão da plataforma.
    expect(data[0].actor).toBeNull();
  });

  it("apagar o próprio post não gera aviso", async () => {
    const dono = await registrar("Dono");
    const post = (await publicar(dono.token)).body.post;

    await request(app).delete(`/social/posts/${post.id}`).set(auth(dono.token)).expect(200);

    expect(await Notification.countDocuments({ user: dono.id })).toBe(0);
  });

  it("quem denunciou recebe a resposta, removido ou mantido", async () => {
    const dono = await registrar("Dono");
    const post = (await publicar(dono.token)).body.post;
    const ana = await registrar("Ana");
    const bruno = await registrar("Bruno");
    const mod = await admin();

    for (const quem of [ana, bruno]) {
      await request(app)
        .post(`/social/posts/${post.id}/report`)
        .set(auth(quem.token))
        .send({ reason: "spam" })
        .expect(201);
    }

    const denuncia = await Report.findOne({ reporter: ana.id });
    const r = await request(app)
      .post(`/admin/reports/${denuncia!._id}/resolve`)
      .set(auth(mod.painel))
      .send({ decision: "mantido", reason: "não infringe" })
      .expect(200);

    expect(r.body.data.denunciantesAvisados).toBe(2);
    const deAna = await listar(ana.token);
    expect(deAna.data[0].text).toMatch(/continua no ar/i);
    expect(deAna.data[0].type).toBe("denuncia_resolvida");
  });

  it("uma segunda decisão sobre o mesmo conteúdo não avisa quem já foi avisado", async () => {
    const dono = await registrar("Dono");
    const post = (await publicar(dono.token)).body.post;
    const ana = await registrar("Ana");
    const mod = await admin();

    await request(app)
      .post(`/social/posts/${post.id}/report`)
      .set(auth(ana.token))
      .send({ reason: "spam" });

    const denuncia = await Report.findOne({ reporter: ana.id });
    const url = `/admin/reports/${denuncia!._id}/resolve`;
    await request(app)
      .post(url)
      .set(auth(mod.painel))
      .send({ decision: "mantido", reason: "não infringe" })
      .expect(200);
    const segunda = await request(app)
      .post(url)
      .set(auth(mod.painel))
      .send({ decision: "mantido", reason: "revisando de novo" });

    expect(segunda.body.data.denunciantesAvisados).toBe(0);
    expect(await Notification.countDocuments({ user: ana.id })).toBe(1);
  });

  it("o aviso de remoção sobrevive à limpeza que a exclusão faz", async () => {
    const dono = await registrar("Dono");
    const post = (await publicar(dono.token)).body.post;
    const ana = await registrar("Ana");
    await curtir(ana.token, post.id);
    const mod = await admin();

    // Excluir apaga as notificações que apontavam para o post. Se o aviso de
    // remoção fosse criado antes disso, iria embora junto com elas.
    await request(app).delete(`/social/posts/${post.id}`).set(auth(mod.token)).expect(200);

    const { data } = await listar(dono.token);
    expect(data.map((d: { type: string }) => d.type)).toEqual(["post_removido"]);
  });
});

describe("Ninguém é notificado da própria ação", () => {
  it("curtir e comentar no próprio post não notifica", async () => {
    const eu = await registrar();
    const post = (await publicar(eu.token)).body.post;

    await curtir(eu.token, post.id);
    await comentar(eu.token, post.id, "eu mesmo");

    expect(await Notification.countDocuments({ user: eu.id })).toBe(0);
  });
});
