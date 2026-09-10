import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../app.js";
import { User } from "../models/User.js";

const app = createApp();
let mongod: MongoMemoryServer;
let ipSeq = 0;
const ip = () => `198.18.0.${++ipSeq}`;
const SENHA = "senha-bem-longa";
const NOVA = "outra-senha-bem-longa";

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await User.deleteMany({});
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function registrar(email = "pessoa@teste.com") {
  const r = await request(app).post("/auth/register").send({ name: "Fulano", email, password: SENHA });
  return { token: r.body.token as string, id: r.body.user.id as string, email };
}

const trocar = (token: string, atual: string, nova: string) =>
  request(app).patch("/auth/password").set(auth(token)).set("X-Forwarded-For", ip()).send({ atual, nova });

describe("Trocar a senha", () => {
  it("troca e permite entrar com a nova", async () => {
    const u = await registrar();

    const r = await trocar(u.token, SENHA, NOVA);
    expect(r.status).toBe(200);

    const comNova = await request(app).post("/auth/login").send({ email: u.email, password: NOVA });
    const comAntiga = await request(app).post("/auth/login").send({ email: u.email, password: SENHA });

    expect(comNova.status).toBe(200);
    expect(comAntiga.status).toBe(401);
  });

  it("derruba as sessões antigas — quem estava dentro sai", async () => {
    const u = await registrar();
    // Uma segunda sessão, como se fosse outro aparelho.
    const outroAparelho = (await request(app).post("/auth/login").send({ email: u.email, password: SENHA }))
      .body.token as string;

    expect((await request(app).get("/auth/me").set(auth(outroAparelho))).status).toBe(200);

    await trocar(u.token, SENHA, NOVA).expect(200);

    // Se trocar a senha não expulsasse quem entrou na conta, a troca não
    // protegeria de nada.
    const depois = await request(app).get("/auth/me").set(auth(outroAparelho));
    expect(depois.status).toBe(401);
    expect(depois.body.error).toMatch(/senha mudou/i);
  });

  it("mas quem trocou continua dentro, com o token novo", async () => {
    const u = await registrar();

    const r = await trocar(u.token, SENHA, NOVA);
    const novoToken = r.body.data.token as string;

    // O token antigo caiu junto com os outros...
    expect((await request(app).get("/auth/me").set(auth(u.token))).status).toBe(401);
    // ...e o novo já veio na resposta, então ninguém precisa entrar de novo.
    expect((await request(app).get("/auth/me").set(auth(novoToken))).status).toBe(200);
  });

  it("NÃO desloga quem tinha token emitido antes deste campo existir", async () => {
    const u = await registrar();
    // Token no formato antigo: sem o campo de versão.
    const tokenAntigo = jwt.sign({ sub: u.id }, process.env.JWT_SECRET!, { expiresIn: "30d" });

    // É a regressão que derrubaria a base inteira num deploy.
    expect((await request(app).get("/auth/me").set(auth(tokenAntigo))).status).toBe(200);
  });

  it("recusa senha atual errada", async () => {
    const u = await registrar();
    const r = await trocar(u.token, "chute-errado-longo", NOVA);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/não confere/i);
  });

  it("recusa nova senha curta e senha igual à atual", async () => {
    const u = await registrar();
    expect((await trocar(u.token, SENHA, "curta")).status).toBe(400);
    expect((await trocar(u.token, SENHA, SENHA)).status).toBe(400);
  });

  it("segura tentativa repetida de adivinhar a senha atual", async () => {
    const u = await registrar();
    const mesmoIp = ip();
    let ultimo = 0;
    for (let i = 0; i < 7; i++) {
      ultimo = (
        await request(app).patch("/auth/password").set(auth(u.token))
          .set("X-Forwarded-For", mesmoIp).send({ atual: `chute-${i}-longo`, nova: NOVA })
      ).status;
    }
    expect(ultimo).toBe(429);
  });
});

describe("Preferências", () => {
  it("vêm com um padrão sensato: nada público, tudo notificando", async () => {
    const u = await registrar();

    const r = await request(app).get("/auth/settings").set(auth(u.token));

    expect(r.body.data.activitiesPublic).toBeNull();
    expect(r.body.data.routesPublic).toBe(false);
    expect(r.body.data.notificacoes.interacoes).toBe(true);
  });

  it("altera uma preferência sem apagar as outras", async () => {
    const u = await registrar();

    await request(app).patch("/auth/settings").set(auth(u.token)).send({ activitiesPublic: true });
    await request(app).patch("/auth/settings").set(auth(u.token))
      .send({ notificacoes: { novosPosts: false } });

    const r = await request(app).get("/auth/settings").set(auth(u.token));
    expect(r.body.data.activitiesPublic).toBe(true);
    expect(r.body.data.notificacoes.novosPosts).toBe(false);
    // As que não foram tocadas continuam como estavam.
    expect(r.body.data.notificacoes.interacoes).toBe(true);
  });

  it("nasce sem escolha de programação — o app é quem pergunta", async () => {
    const u = await registrar();

    const r = await request(app).get("/auth/settings").set(auth(u.token));

    // null é o que faz a Home mostrar as opções em vez de cobrar um plano.
    expect(r.body.data.programacao).toBeNull();
  });

  it("grava seguir a própria programação, e volta atrás", async () => {
    const u = await registrar();

    await request(app).patch("/auth/settings").set(auth(u.token))
      .send({ programacao: "propria" }).expect(200);
    expect((await request(app).get("/auth/settings").set(auth(u.token))).body.data.programacao)
      .toBe("propria");

    await request(app).patch("/auth/settings").set(auth(u.token))
      .send({ programacao: "plano" }).expect(200);
    expect((await request(app).get("/auth/settings").set(auth(u.token))).body.data.programacao)
      .toBe("plano");
  });

  it("a escolha chega junto do usuário, não só em /settings", async () => {
    const u = await registrar();
    await request(app).patch("/auth/settings").set(auth(u.token)).send({ programacao: "propria" });

    // A Home lê do usuário em memória; sem isto ela cobraria plano até um
    // recarregamento de settings acontecer.
    const me = await request(app).get("/auth/me").set(auth(u.token));
    expect(me.body.user.settings.programacao).toBe("propria");
  });

  it("recusa valor inventado", async () => {
    const u = await registrar();
    const r = await request(app).patch("/auth/settings").set(auth(u.token))
      .send({ programacao: "sei_la" });
    expect(r.status).toBe(400);
  });

  it("exige autenticação", async () => {
    expect((await request(app).get("/auth/settings")).status).toBe(401);
    expect((await request(app).patch("/auth/password").send({ atual: "a", nova: "b" })).status).toBe(401);
  });
});
