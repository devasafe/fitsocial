import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../../app.js";
import { User } from "../../models/User.js";
import { UserDailyActive } from "../../models/UserDailyActive.js";
import { grantAdmin } from "../../scripts/grantAdmin.js";

const app = createApp();
let mongod: MongoMemoryServer;
let ipSeq = 0;
const ip = () => `192.0.2.${++ipSeq}`;
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
  await Promise.all([User.deleteMany({}), UserDailyActive.deleteMany({})]);
});

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

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("Métricas do painel", () => {
  it("responde o panorama completo", async () => {
    const t = await admin();
    await registrar("gente@teste.com");

    const r = await request(app).get("/admin/metrics/overview?dias=30").set(auth(t));

    expect(r.status).toBe(200);
    expect(r.body.data.totais.contas).toBe(2);
    expect(r.body.data.series.novos).toHaveLength(30);
    expect(r.body.data.series.ativos).toHaveLength(30);
    expect(r.body.meta.fuso).toBe("America/Sao_Paulo");
    expect(typeof r.body.meta.tookMs).toBe("number");
  });

  it("limita a janela pedida", async () => {
    const t = await admin();

    const curto = await request(app).get("/admin/metrics/overview?dias=1").set(auth(t));
    const longo = await request(app).get("/admin/metrics/overview?dias=9999").set(auth(t));

    expect(curto.body.meta.dias).toBe(7); // piso
    expect(longo.body.meta.dias).toBe(180); // teto
  });

  it("registra o acesso de quem usa o app", async () => {
    const t = await admin();
    const u = await registrar("visitante@teste.com");

    // Uma requisição autenticada qualquer já marca presença.
    await request(app).get("/social/feed").set(auth(u.token));
    // A marcação não é aguardada pela requisição, então damos um instante.
    await new Promise((r) => setTimeout(r, 250));

    const marcacoes = await UserDailyActive.countDocuments({ user: u.id });
    expect(marcacoes).toBe(1);

    const r = await request(app).get("/admin/metrics/overview?dias=7").set(auth(t));
    expect(r.body.data.acessoDesde).not.toBeNull();
  });

  it("não deixa usuário comum ver as métricas", async () => {
    const comum = await registrar("comum@teste.com");
    const r = await request(app).get("/admin/metrics/overview").set(auth(comum.token));
    expect(r.status).toBe(403);
  });

  it("exige autenticação", async () => {
    expect((await request(app).get("/admin/metrics/overview")).status).toBe(401);
  });
});
