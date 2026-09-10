import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Post } from "../models/Post.js";
import { Report } from "../models/Report.js";
import { Notification } from "../models/Notification.js";
import { Comment } from "../models/Comment.js";
import { Like } from "../models/Like.js";
import { AdminAudit } from "../models/AdminAudit.js";
import { grantAdmin } from "../scripts/grantAdmin.js";

const app = createApp();
let mongod: MongoMemoryServer;
let ipSeq = 0;
const ip = () => `203.0.113.${++ipSeq}`;
const SENHA = "senha-bem-longa";

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
    User.deleteMany({}), Post.deleteMany({}), Report.deleteMany({}),
    Notification.deleteMany({}), Comment.deleteMany({}), Like.deleteMany({}),
    AdminAudit.deleteMany({}),
  ]);
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function registrar(email: string) {
  const r = await request(app).post("/auth/register").send({ name: "Fulano", email, password: SENHA });
  return { token: r.body.token as string, id: r.body.user.id as string };
}

async function admin(email = "chefe@teste.com") {
  await registrar(email);
  await grantAdmin(email, { force: true });
  const r = await request(app).post("/admin/session").set("X-Forwarded-For", ip())
    .send({ email, password: SENHA });
  return r.body.data.token as string;
}

async function publicar(token: string, text = "meu treino de hoje") {
  const r = await request(app).post("/social/posts").set(auth(token)).send({ text });
  return r.body.post.id as string;
}

describe("Editar o próprio post", () => {
  it("altera o texto e marca como editado", async () => {
    const u = await registrar("autor@teste.com");
    const id = await publicar(u.token, "hoje foi leve");

    const r = await request(app).patch(`/social/posts/${id}`).set(auth(u.token))
      .send({ text: "hoje foi pesado demais!" });

    expect(r.status).toBe(200);
    expect(r.body.data.text).toBe("hoje foi pesado demais!");
    expect(r.body.data.editedAt).toBeTruthy();
  });

  it("post nunca editado não vem marcado", async () => {
    const u = await registrar("autor@teste.com");
    const id = await publicar(u.token);

    const r = await request(app).get(`/social/posts/${id}`).set(auth(u.token));
    expect(r.body.post.editedAt).toBeNull();
  });

  it("ninguém edita post alheio", async () => {
    const autor = await registrar("autor@teste.com");
    const outro = await registrar("outro@teste.com");
    const id = await publicar(autor.token);

    const r = await request(app).patch(`/social/posts/${id}`).set(auth(outro.token))
      .send({ text: "mudei o que você disse" });

    expect(r.status).toBe(403);
  });

  it("nem o admin edita post alheio", async () => {
    const adm = await admin();
    const autor = await registrar("autor@teste.com");
    const id = await publicar(autor.token);

    const r = await request(app).patch(`/social/posts/${id}`).set(auth(adm))
      .send({ text: "adulterado" });

    // Moderar é remover ou manter — nunca reescrever o que a pessoa disse.
    expect(r.status).toBe(403);
  });

  it("não deixa o post ficar vazio", async () => {
    const u = await registrar("autor@teste.com");
    const id = await publicar(u.token, "só texto, sem foto");

    const r = await request(app).patch(`/social/posts/${id}`).set(auth(u.token)).send({ text: "   " });
    expect(r.status).toBe(400);
  });
});

describe("Excluir o próprio post", () => {
  it("some do feed, do perfil e do post único", async () => {
    const u = await registrar("autor@teste.com");
    const id = await publicar(u.token);

    await request(app).delete(`/social/posts/${id}`).set(auth(u.token)).expect(200);

    const feed = await request(app).get("/social/feed").set(auth(u.token));
    const perfil = await request(app).get(`/social/users/${u.id}`).set(auth(u.token));
    const unico = await request(app).get(`/social/posts/${id}`).set(auth(u.token));

    expect(feed.body.posts).toHaveLength(0);
    expect(perfil.body.posts).toHaveLength(0);
    expect(perfil.body.counts.posts).toBe(0);
    // Quem chega por link antigo entende o que aconteceu.
    expect(unico.status).toBe(410);
    expect(unico.body.error).toMatch(/não está mais disponível/i);
  });

  it("leva junto as notificações que apontavam para ele", async () => {
    const autor = await registrar("autor@teste.com");
    const fa = await registrar("fa@teste.com");
    const id = await publicar(autor.token);
    await request(app).post(`/social/posts/${id}/like`).set(auth(fa.token));

    expect(await Notification.countDocuments({ targetId: id })).toBe(1);

    await request(app).delete(`/social/posts/${id}`).set(auth(autor.token)).expect(200);

    // Notificação que leva a lugar nenhum é pior que notificação nenhuma.
    expect(await Notification.countDocuments({ targetId: id })).toBe(0);
  });

  it("não deixa curtir nem comentar depois de excluído", async () => {
    const autor = await registrar("autor@teste.com");
    const outro = await registrar("outro@teste.com");
    const id = await publicar(autor.token);
    await request(app).delete(`/social/posts/${id}`).set(auth(autor.token));

    const curtida = await request(app).post(`/social/posts/${id}/like`).set(auth(outro.token));
    const comentario = await request(app).post(`/social/posts/${id}/comments`)
      .set(auth(outro.token)).send({ text: "oi" });

    expect(curtida.status).toBe(404);
    expect(comentario.status).toBe(404);
  });

  it("ninguém exclui post alheio", async () => {
    const autor = await registrar("autor@teste.com");
    const outro = await registrar("outro@teste.com");
    const id = await publicar(autor.token);

    const r = await request(app).delete(`/social/posts/${id}`).set(auth(outro.token));
    expect(r.status).toBe(403);
    expect(await Post.countDocuments({ _id: id, deletedAt: null })).toBe(1);
  });

  it("o admin exclui qualquer post, e isso fica registrado", async () => {
    const adm = await admin();
    const autor = await registrar("autor@teste.com");
    const id = await publicar(autor.token);

    await request(app).delete(`/social/posts/${id}`).set(auth(adm)).expect(200);

    const feed = await request(app).get("/social/feed").set(auth(autor.token));
    expect(feed.body.posts).toHaveLength(0);
    expect(await AdminAudit.countDocuments({ action: "post.remove" })).toBe(1);
  });
});

describe("Denunciar", () => {
  it("registra a denúncia com o motivo e guarda o conteúdo", async () => {
    const autor = await registrar("autor@teste.com");
    const quemDenuncia = await registrar("vigilante@teste.com");
    const id = await publicar(autor.token, "conteúdo problemático");

    const r = await request(app).post(`/social/posts/${id}/report`)
      .set(auth(quemDenuncia.token)).send({ reason: "spam" });

    expect(r.status).toBe(201);
    const d = await Report.findOne({ targetId: id });
    expect(d!.reason).toBe("spam");
    expect(d!.status).toBe("pendente");
    // O conteúdo pode sumir antes da análise; o snapshot garante o contexto.
    expect(d!.snapshot?.texto).toBe("conteúdo problemático");
  });

  it("denunciar duas vezes não cria duas denúncias", async () => {
    const autor = await registrar("autor@teste.com");
    const quemDenuncia = await registrar("vigilante@teste.com");
    const id = await publicar(autor.token);

    await request(app).post(`/social/posts/${id}/report`).set(auth(quemDenuncia.token)).send({ reason: "spam" });
    const segunda = await request(app).post(`/social/posts/${id}/report`)
      .set(auth(quemDenuncia.token)).send({ reason: "odio" });

    // Responde como sucesso: dizer "você já denunciou" não ajuda ninguém.
    expect(segunda.status).toBe(201);
    expect(await Report.countDocuments({ targetId: id })).toBe(1);
  });

  it("não dá para denunciar o próprio post", async () => {
    const u = await registrar("autor@teste.com");
    const id = await publicar(u.token);

    const r = await request(app).post(`/social/posts/${id}/report`).set(auth(u.token)).send({ reason: "spam" });
    expect(r.status).toBe(400);
  });

  it("recusa motivo inventado", async () => {
    const autor = await registrar("autor@teste.com");
    const outro = await registrar("outro@teste.com");
    const id = await publicar(autor.token);

    const r = await request(app).post(`/social/posts/${id}/report`)
      .set(auth(outro.token)).send({ reason: "nao_gostei" });
    expect(r.status).toBe(400);
  });
});

describe("Fila de denúncias do painel", () => {
  it("agrupa por conteúdo: dez denúncias no mesmo post viram um item", async () => {
    const adm = await admin();
    const autor = await registrar("autor@teste.com");
    const id = await publicar(autor.token, "polêmico");

    for (let i = 0; i < 3; i++) {
      const d = await registrar(`denunciante${i}@teste.com`);
      await request(app).post(`/social/posts/${id}/report`).set(auth(d.token)).send({ reason: "spam" });
    }

    const fila = await request(app).get("/admin/reports").set(auth(adm));

    expect(fila.body.data).toHaveLength(1);
    expect(fila.body.data[0].denuncias).toBe(3);
    expect(fila.body.data[0].conteudo.texto).toBe("polêmico");
    expect(fila.body.data[0].aindaNoAr).toBe(true);
  });

  it("remover pelo painel tira o post do ar e fecha todas as denúncias", async () => {
    const adm = await admin();
    const autor = await registrar("autor@teste.com");
    const d1 = await registrar("d1@teste.com");
    const d2 = await registrar("d2@teste.com");
    const id = await publicar(autor.token);
    await request(app).post(`/social/posts/${id}/report`).set(auth(d1.token)).send({ reason: "odio" });
    await request(app).post(`/social/posts/${id}/report`).set(auth(d2.token)).send({ reason: "assedio" });

    const fila = await request(app).get("/admin/reports").set(auth(adm));
    const reportId = fila.body.data[0].reportId;

    const r = await request(app).post(`/admin/reports/${reportId}/resolve`).set(auth(adm))
      .send({ decision: "removido", reason: "discurso de ódio confirmado" });

    expect(r.status).toBe(200);
    expect(r.body.data.denunciasFechadas).toBe(2);
    expect((await Post.findById(id))!.deletedAt).toBeTruthy();
    expect(await Report.countDocuments({ status: "pendente" })).toBe(0);
  });

  it("manter o post fecha as denúncias sem remover nada", async () => {
    const adm = await admin();
    const autor = await registrar("autor@teste.com");
    const d1 = await registrar("d1@teste.com");
    const id = await publicar(autor.token);
    await request(app).post(`/social/posts/${id}/report`).set(auth(d1.token)).send({ reason: "spam" });

    const fila = await request(app).get("/admin/reports").set(auth(adm));
    await request(app).post(`/admin/reports/${fila.body.data[0].reportId}/resolve`).set(auth(adm))
      .send({ decision: "mantido", reason: "não viola nada" }).expect(200);

    expect((await Post.findById(id))!.deletedAt).toBeNull();
    expect(await Report.countDocuments({ status: "rejeitada" })).toBe(1);
  });

  it("mostra quando o autor apagou antes da análise", async () => {
    const adm = await admin();
    const autor = await registrar("autor@teste.com");
    const d1 = await registrar("d1@teste.com");
    const id = await publicar(autor.token);
    await request(app).post(`/social/posts/${id}/report`).set(auth(d1.token)).send({ reason: "spam" });
    await request(app).delete(`/social/posts/${id}`).set(auth(autor.token));

    // Excluir já resolve a denúncia; ela sai da fila de pendentes.
    const pendentes = await request(app).get("/admin/reports").set(auth(adm));
    const todas = await request(app).get("/admin/reports?status=todas").set(auth(adm));

    expect(pendentes.body.data).toHaveLength(0);
    expect(todas.body.data[0].aindaNoAr).toBe(false);
    // O conteúdo denunciado continua legível para quem precisar auditar.
    expect(todas.body.data[0].conteudo.texto).toBeTruthy();
  });

  it("usuário comum não vê a fila", async () => {
    const comum = await registrar("comum@teste.com");
    const r = await request(app).get("/admin/reports").set(auth(comum.token));
    expect(r.status).toBe(403);
  });

  it("resolver exige explicar a decisão", async () => {
    const adm = await admin();
    const autor = await registrar("autor@teste.com");
    const d1 = await registrar("d1@teste.com");
    const id = await publicar(autor.token);
    await request(app).post(`/social/posts/${id}/report`).set(auth(d1.token)).send({ reason: "spam" });
    const fila = await request(app).get("/admin/reports").set(auth(adm));

    const r = await request(app).post(`/admin/reports/${fila.body.data[0].reportId}/resolve`)
      .set(auth(adm)).send({ decision: "mantido" });
    expect(r.status).toBe(400);
  });
});
