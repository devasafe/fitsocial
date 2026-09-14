import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../../app.js";
import { User } from "../../models/User.js";
import { Cupom } from "../../models/Cupom.js";
import { CupomUso } from "../../models/CupomUso.js";
import { AdminAudit } from "../../models/AdminAudit.js";
import { grantAdmin } from "../../scripts/grantAdmin.js";

const app = createApp();
let mongod: MongoMemoryServer;
let adminToken = "";
// O rate limit da sessão do painel conta por IP: sem variar, o quinto teste
// tomaria 429 e a suíte falharia por um motivo que não é o dela.
let ipSeq = 0;
const ip = () => `198.51.100.${++ipSeq}`;
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
    User.deleteMany({}),
    Cupom.deleteMany({}),
    CupomUso.deleteMany({}),
    AdminAudit.deleteMany({}),
  ]);
  await request(app)
    .post("/auth/register")
    .send({ name: "Chefe", email: "admin@teste.com", password: SENHA });
  await grantAdmin("admin@teste.com", { force: true });
  const s = await request(app)
    .post("/admin/session")
    .set("X-Forwarded-For", ip())
    .send({ email: "admin@teste.com", password: SENHA });
  adminToken = s.body.data.token;
});

const auth = () => ({ Authorization: `Bearer ${adminToken}` });
const criar = (corpo: Record<string, unknown>) =>
  request(app).post("/admin/cupons").set(auth()).send(corpo);

describe("criar cupom pelo painel", () => {
  it("cria um cupom de parceria com comissão", async () => {
    const r = await criar({
      codigo: "joao10",
      descricao: "Parceria com o João",
      desconto: { tipo: "percentual", valor: 10 },
      parceiro: { nome: "João Silva", contato: "@joao", comissaoPercentual: 30 },
    });

    expect(r.status).toBe(201);
    // Normalizado: quem digita "joao10" e quem digita "JOAO10" acha o mesmo.
    expect(r.body.data.codigo).toBe("JOAO10");
    expect(r.body.data.desconto.rotulo).toBe("10%");
    expect(r.body.data.parceiro.comissaoPercentual).toBe(30);
    expect(r.body.data.relatorio.entraram).toBe(0);
  });

  it("sorteia um código legível quando não se informa um", async () => {
    const r = await criar({ desconto: { tipo: "percentual", valor: 5 } });

    expect(r.status).toBe(201);
    // Sem I, O, 0 e 1: o código vai ser ditado por telefone e escrito em story.
    expect(r.body.data.codigo).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });

  it("recusa cupom que não faz nada", async () => {
    const r = await criar({ descricao: "só um nome" });

    // Sem desconto e sem parceiro ele não teria efeito nenhum, e a pergunta
    // seguinte seria "criei e não aconteceu nada, por quê?".
    expect(r.status).toBe(400);
  });

  it("recusa código repetido", async () => {
    await criar({ codigo: "IGUAL", desconto: { tipo: "valor", valor: 500 } });
    const r = await criar({ codigo: "igual", desconto: { tipo: "valor", valor: 900 } });

    expect(r.status).toBe(409);
  });

  it("recusa desconto percentual acima de 100", async () => {
    const r = await criar({ desconto: { tipo: "percentual", valor: 120 } });
    expect(r.status).toBe(400);
  });

  it("grava na auditoria com a comissão combinada", async () => {
    await criar({
      codigo: "AUDIT",
      desconto: { tipo: "percentual", valor: 10 },
      parceiro: { nome: "Parceiro", comissaoPercentual: 40 },
    });

    const log = (await AdminAudit.findOne({ action: "cupom.create" }))!;
    expect(log).toBeTruthy();
    expect(log.targetLabel).toBe("AUDIT");
    // É o registro que responde "com que comissão esse cupom foi criado?" no
    // dia em que o parceiro discordar do valor. A allowlist da auditoria
    // descarta campo desconhecido em SILÊNCIO, então isto é um teste de
    // regressão, não uma formalidade.
    expect((log.after as Record<string, unknown>)?.comissao).toBe(40);
  });
});

describe("revogar e reativar", () => {
  it("revoga sem apagar, e reativa depois", async () => {
    await criar({ codigo: "REVOG", desconto: { tipo: "valor", valor: 500 } });

    const r1 = await request(app)
      .post("/admin/cupons/REVOG/revogar")
      .set(auth())
      .send({ motivo: "campanha encerrada" });
    expect(r1.status).toBe(200);
    expect(r1.body.data.revogadoEm).toBeTruthy();
    // O cupom continua existindo: quem entrou por ele segue no relatório do
    // parceiro, e apagar reescreveria o passado de quem tem a receber.
    expect(await Cupom.countDocuments({ codigo: "REVOG" })).toBe(1);

    const r2 = await request(app)
      .post("/admin/cupons/REVOG/reativar")
      .set(auth())
      .send({ motivo: "revoguei sem querer" });
    expect(r2.status).toBe(200);
    expect(r2.body.data.revogadoEm).toBeNull();
  });

  it("revogar duas vezes é recusado", async () => {
    await criar({ codigo: "DUPLO", desconto: { tipo: "valor", valor: 500 } });
    await request(app).post("/admin/cupons/DUPLO/revogar").set(auth()).send({ motivo: "primeira" });
    const r = await request(app)
      .post("/admin/cupons/DUPLO/revogar")
      .set(auth())
      .send({ motivo: "segunda" });
    expect(r.status).toBe(409);
  });

  it("toda ação exige motivo", async () => {
    await criar({ codigo: "SEMMOT", desconto: { tipo: "valor", valor: 500 } });
    const r = await request(app).post("/admin/cupons/SEMMOT/revogar").set(auth()).send({});
    expect(r.status).toBe(400);
  });
});

describe("o relatório de parceria", () => {
  it("conta quem entrou, quem pagou e quanto o parceiro tem a receber", async () => {
    await criar({
      codigo: "REL",
      parceiro: { nome: "Parceira", comissaoPercentual: 20 },
    });
    // Duas pessoas entraram; só uma pagou.
    const a = await User.create({ name: "A", email: "a@t.com", passwordHash: "x".repeat(20) });
    const b = await User.create({ name: "B", email: "b@t.com", passwordHash: "x".repeat(20) });
    await CupomUso.create({ cupom: "REL", user: a._id, origem: "cadastro" });
    await CupomUso.create({
      cupom: "REL",
      user: b._id,
      origem: "cadastro",
      primeiraCompraEm: new Date(),
      totalPagoCentavos: 2990,
      comissaoTotalCentavos: 598,
    });

    const r = await request(app).get("/admin/cupons/REL").set(auth());

    expect(r.status).toBe(200);
    const rel = r.body.data.relatorio;
    expect(rel.entraram).toBe(2);
    expect(rel.pagaram).toBe(1);
    // O número que mostra se o cupom traz gente que converte ou só gente que olha.
    expect(rel.gratis).toBe(1);
    expect(rel.receitaFormatada).toBe("R$ 29,90");
    expect(rel.comissaoFormatada).toBe("R$ 5,98");
    // O que sobra depois de pagar o parceiro: é o número da decisão.
    expect(rel.liquidoFormatado).toBe("R$ 23,92");

    // E a lista de quem entrou, para conferir caso a caso.
    expect(r.body.data.usos).toHaveLength(2);
    expect(r.body.data.usos.map((u: { email: string }) => u.email).sort()).toEqual([
      "a@t.com",
      "b@t.com",
    ]);
  });

  it("a lista esconde os revogados por padrão, e mostra sob pedido", async () => {
    await criar({ codigo: "VIVO", desconto: { tipo: "valor", valor: 500 } });
    await criar({ codigo: "MORTO", desconto: { tipo: "valor", valor: 500 } });
    await request(app).post("/admin/cupons/MORTO/revogar").set(auth()).send({ motivo: "fim" });

    const padrao = await request(app).get("/admin/cupons").set(auth());
    expect(padrao.body.data.map((c: { codigo: string }) => c.codigo)).toEqual(["VIVO"]);

    const todos = await request(app).get("/admin/cupons?todos=1").set(auth());
    expect(todos.body.data).toHaveLength(2);
  });
});

describe("quem não é admin não entra", () => {
  it("conta comum recebe 403", async () => {
    const c = await request(app)
      .post("/auth/register")
      .send({ name: "Comum", email: "comum@teste.com", password: SENHA });
    const r = await request(app)
      .get("/admin/cupons")
      .set({ Authorization: `Bearer ${c.body.token}` });
    expect(r.status).toBe(403);
  });
});
