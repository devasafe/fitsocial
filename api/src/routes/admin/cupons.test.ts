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

  it("as três abas separam ativos, revogados e todos", async () => {
    await criar({ codigo: "VIVO", desconto: { tipo: "valor", valor: 500 } });
    await criar({ codigo: "MORTO", desconto: { tipo: "valor", valor: 500 } });
    await request(app).post("/admin/cupons/MORTO/revogar").set(auth()).send({ motivo: "fim" });

    const ativos = await request(app).get("/admin/cupons").set(auth());
    expect(ativos.body.data.map((c: { codigo: string }) => c.codigo)).toEqual(["VIVO"]);

    // A aba que faltava. Sem ela, revogar fazia o cupom desaparecer da tela
    // sem nada explicando — e "revogar não funciona" era a leitura óbvia.
    const revogados = await request(app).get("/admin/cupons?status=revogados").set(auth());
    expect(revogados.body.data.map((c: { codigo: string }) => c.codigo)).toEqual(["MORTO"]);

    const todos = await request(app).get("/admin/cupons?status=todos").set(auth());
    expect(todos.body.data).toHaveLength(2);

    // E os contadores das abas vêm no meta, em qualquer uma delas.
    expect(ativos.body.meta.ativos).toBe(1);
    expect(ativos.body.meta.revogados).toBe(1);
    expect(revogados.body.meta.ativos).toBe(1);
  });

  it("o `todos=1` antigo continua funcionando", async () => {
    // O painel velho, se alguém tiver a aba aberta, não pode quebrar.
    await criar({ codigo: "COMPAT", desconto: { tipo: "valor", valor: 500 } });
    await request(app).post("/admin/cupons/COMPAT/revogar").set(auth()).send({ motivo: "fim" });
    const r = await request(app).get("/admin/cupons?todos=1").set(auth());
    expect(r.body.data).toHaveLength(1);
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

describe("editar cupom", () => {
  it("muda a comissão sem reescrever o que já foi vendido", async () => {
    await criar({
      codigo: "EDIT",
      desconto: { tipo: "percentual", valor: 10 },
      parceiro: { nome: "Antes", comissaoPercentual: 10 },
    });

    const r = await request(app)
      .patch("/admin/cupons/EDIT")
      .set(auth())
      .send({
        motivo: "renegociei a comissão",
        parceiro: { nome: "Depois", comissaoPercentual: 40 },
      });

    expect(r.status).toBe(200);
    expect(r.body.data.parceiro.nome).toBe("Depois");
    expect(r.body.data.parceiro.comissaoPercentual).toBe(40);
    // O desconto não foi mandado, então não pode ter sido apagado: `undefined`
    // quer dizer "não mexi", e só `null` quer dizer "tire".
    expect(r.body.data.desconto.valor).toBe(10);
  });

  it("tirar o parceiro é diferente de não mexer nele", async () => {
    await criar({
      codigo: "TIRAR",
      desconto: { tipo: "percentual", valor: 10 },
      parceiro: { nome: "Alguém", comissaoPercentual: 10 },
    });

    const so = await request(app)
      .patch("/admin/cupons/TIRAR")
      .set(auth())
      .send({ motivo: "só a descrição", descricao: "nova descrição" });
    // Editar a descrição não pode apagar o parceiro de tabela.
    expect(so.body.data.parceiro.nome).toBe("Alguém");

    const tira = await request(app)
      .patch("/admin/cupons/TIRAR")
      .set(auth())
      .send({ motivo: "parceria encerrada", parceiro: null });
    expect(tira.body.data.parceiro).toBeNull();
  });

  it("não deixa o cupom ficar sem desconto E sem parceiro", async () => {
    await criar({ codigo: "VAZIO", desconto: { tipo: "percentual", valor: 10 } });

    const r = await request(app)
      .patch("/admin/cupons/VAZIO")
      .set(auth())
      .send({ motivo: "tirando tudo", desconto: null });

    // Sobraria um cupom que não faz nada, e a pergunta seguinte seria "por que
    // não acontece nada quando alguém usa?".
    expect(r.status).toBe(400);
  });

  it("editar exige motivo e grava na auditoria", async () => {
    await criar({ codigo: "AUD2", desconto: { tipo: "percentual", valor: 10 } });

    const semMotivo = await request(app)
      .patch("/admin/cupons/AUD2")
      .set(auth())
      .send({ descricao: "sem motivo" });
    expect(semMotivo.status).toBe(400);

    await request(app)
      .patch("/admin/cupons/AUD2")
      .set(auth())
      .send({ motivo: "ajuste de campanha", desconto: { tipo: "percentual", valor: 25 } });

    const log = (await AdminAudit.findOne({ action: "cupom.update" }))!;
    expect(log.reason).toBe("ajuste de campanha");
    expect((log.before as Record<string, unknown>)?.desconto).toBeTruthy();
  });

  it("avisa quando o teto novo já deixa o cupom esgotado", async () => {
    await criar({ codigo: "TETO", desconto: { tipo: "percentual", valor: 10 } });
    await Cupom.updateOne({ codigo: "TETO" }, { $set: { usos: 5 } });

    const r = await request(app)
      .patch("/admin/cupons/TETO")
      .set(auth())
      .send({ motivo: "encerrando", limiteDeUsos: 3 });

    expect(r.status).toBe(200);
    // Baixar o teto é um jeito legítimo de encerrar. O aviso evita a pergunta
    // "por que ninguém consegue mais usar?".
    expect(r.body.meta.esgotado).toBe(true);
  });
});

describe("o histórico de cupons na ficha da pessoa", () => {
  it("mostra por onde ela chegou e o que rendeu", async () => {
    await criar({
      codigo: "HIST",
      parceiro: { nome: "Parceiro do Histórico", comissaoPercentual: 20 },
    });
    const p = await request(app)
      .post("/auth/register")
      .send({ name: "Trazida", email: "trazida@t.com", password: SENHA, cupom: "HIST" });
    const id = p.body.user.id as string;

    const r = await request(app).get(`/admin/users/${id}`).set(auth());

    expect(r.status).toBe(200);
    expect(r.body.data.cupons).toHaveLength(1);
    const c = r.body.data.cupons[0];
    expect(c.codigo).toBe("HIST");
    expect(c.origem).toBe("cadastro");
    expect(c.parceiro).toBe("Parceiro do Histórico");
    expect(c.primeiraCompraEm).toBeNull();
    expect(c.totalPagoFormatado).toBe("R$ 0,00");
  });

  it("um cupom revogado depois continua no histórico de quem entrou por ele", async () => {
    await criar({ codigo: "REVHIST", parceiro: { nome: "Parceiro", comissaoPercentual: 10 } });
    const p = await request(app)
      .post("/auth/register")
      .send({ name: "Antes", email: "antes@t.com", password: SENHA, cupom: "REVHIST" });
    await request(app)
      .post("/admin/cupons/REVHIST/revogar")
      .set(auth())
      .send({ motivo: "encerrada" });

    const r = await request(app).get(`/admin/users/${p.body.user.id}`).set(auth());

    // O uso continua valendo: quem tem a receber não perde o histórico porque
    // o cupom foi encerrado. Os dois fatos aparecem, sem um apagar o outro.
    expect(r.body.data.cupons).toHaveLength(1);
    expect(r.body.data.cupons[0].revogado).toBe(true);
  });

  it("quem não usou cupom nenhum devolve lista vazia", async () => {
    const p = await request(app)
      .post("/auth/register")
      .send({ name: "Sozinha", email: "sozinha@t.com", password: SENHA });
    const r = await request(app).get(`/admin/users/${p.body.user.id}`).set(auth());
    expect(r.body.data.cupons).toEqual([]);
  });
});

describe("nome de parceiro curto é recusado, e o cadastro não sofre", () => {
  it("o cupom não é criado e quem se cadastra com ele entra normalmente", async () => {
    const c = await criar({ codigo: "CURTO", parceiro: { nome: "X", comissaoPercentual: 10 } });
    expect(c.status).toBe(400);

    const p = await request(app)
      .post("/auth/register")
      .send({ name: "Alguém", email: "alguem@t.com", password: SENHA, cupom: "CURTO" });

    // O cupom não existe, e ainda assim a conta é criada. Perder um cadastro
    // por causa de um código que não vale seria perder a pessoa junto.
    expect(p.status).toBe(201);
    expect(await CupomUso.countDocuments({})).toBe(0);
  });
});
