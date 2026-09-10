import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../../app.js";
import { User } from "../../models/User.js";
import { AdminAudit } from "../../models/AdminAudit.js";
import { grantAdmin } from "../../scripts/grantAdmin.js";

const app = createApp();
let mongod: MongoMemoryServer;

// O rateLimit é instanciado no módulo do router, não em createApp — o bucket é
// singleton do processo. Cada teste usa um IP próprio para não gastar a janela
// do vizinho. Funciona porque a API confia no X-Forwarded-For do proxy.
let proximoIp = 0;
const ipNovo = () => `203.0.113.${++proximoIp}`;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), AdminAudit.deleteMany({})]);
});

/** Registra pelo endpoint real e devolve o token do app. */
async function registrar(email: string, senha = "senha-bem-longa") {
  const res = await request(app)
    .post("/auth/register")
    .send({ name: "Fulano", email, password: senha });
  return { token: res.body.token as string, id: res.body.user.id as string, senha };
}

async function entrarNoPainel(email: string, senha: string, ip = ipNovo()) {
  return request(app)
    .post("/admin/session")
    .set("X-Forwarded-For", ip)
    .send({ email, password: senha });
}

describe("Sessão do painel", () => {
  it("recusa quem não é admin, com a MESMA mensagem de senha errada", async () => {
    const { senha } = await registrar("comum@teste.com");

    const semPapel = await entrarNoPainel("comum@teste.com", senha);
    const senhaErrada = await entrarNoPainel("comum@teste.com", "outra-coisa-longa");

    expect(semPapel.status).toBe(401);
    expect(senhaErrada.status).toBe(401);
    // Mensagens distintas revelariam quem é admin no sistema.
    expect(semPapel.body.error).toBe(senhaErrada.body.error);
  });

  it("deixa o admin entrar e devolve token de escopo admin", async () => {
    const { senha } = await registrar("dono@teste.com");
    await grantAdmin("dono@teste.com");

    const res = await entrarNoPainel("dono@teste.com", senha);

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.user.role).toBe("admin");
  });

  it("BLOQUEIA o token do app no painel, mesmo sendo o token do admin", async () => {
    const { token: tokenDoApp, senha } = await registrar("dono@teste.com");
    await grantAdmin("dono@teste.com");

    const comTokenDoApp = await request(app)
      .get("/admin/me")
      .set("Authorization", `Bearer ${tokenDoApp}`);

    const painel = await entrarNoPainel("dono@teste.com", senha);
    const comTokenDoPainel = await request(app)
      .get("/admin/me")
      .set("Authorization", `Bearer ${painel.body.data.token}`);

    // Roubar o celular do dono não pode dar o painel.
    expect(comTokenDoApp.status).toBe(403);
    expect(comTokenDoPainel.status).toBe(200);
    expect(comTokenDoPainel.body.data.role).toBe("admin");
  });

  it("corta o acesso assim que o papel é revogado, sem esperar o token expirar", async () => {
    const { senha } = await registrar("dono@teste.com");
    await grantAdmin("dono@teste.com");
    const painel = await entrarNoPainel("dono@teste.com", senha);
    const token = painel.body.data.token;

    expect((await request(app).get("/admin/me").set("Authorization", `Bearer ${token}`)).status).toBe(200);

    await grantAdmin("dono@teste.com", { revoke: true, force: true });

    // Token continua criptograficamente válido; o papel é lido do banco a cada requisição.
    const depois = await request(app).get("/admin/me").set("Authorization", `Bearer ${token}`);
    expect(depois.status).toBe(403);
  });

  it("exige autenticação nas rotas do painel", async () => {
    expect((await request(app).get("/admin/me")).status).toBe(401);
    expect((await request(app).get("/admin/ai/keys")).status).toBe(401);
  });

  it("registra a auditoria sem nunca gravar o e-mail completo", async () => {
    const { senha } = await registrar("dono@teste.com");
    await grantAdmin("dono@teste.com");
    await entrarNoPainel("dono@teste.com", senha);

    const registros = await AdminAudit.find({});
    expect(registros.length).toBeGreaterThan(0);
    expect(registros.some((r) => r.action === "admin.session")).toBe(true);
    expect(JSON.stringify(registros)).not.toContain("dono@teste.com");
    expect(JSON.stringify(registros)).toContain("d***@teste.com");
  });
});

describe("Script de promoção a admin", () => {
  it("promove e revoga", async () => {
    await registrar("dono@teste.com");

    await grantAdmin("dono@teste.com");
    expect((await User.findOne({ email: "dono@teste.com" }))!.role).toBe("admin");

    await grantAdmin("dono@teste.com", { revoke: true, force: true });
    expect((await User.findOne({ email: "dono@teste.com" }))!.role).toBe("user");
  });

  it("recusa promover um segundo admin sem --force", async () => {
    await registrar("dono@teste.com");
    await registrar("outro@teste.com");
    await grantAdmin("dono@teste.com");

    await expect(grantAdmin("outro@teste.com")).rejects.toThrow(/já existe admin/i);
    await expect(grantAdmin("outro@teste.com", { force: true })).resolves.toBeTruthy();
  });

  it("avisa antes de deixar o sistema sem nenhum admin", async () => {
    await registrar("dono@teste.com");
    await grantAdmin("dono@teste.com");

    await expect(grantAdmin("dono@teste.com", { revoke: true })).rejects.toThrow(/único admin/i);
  });

  it("recusa e-mail inexistente", async () => {
    await expect(grantAdmin("ninguem@teste.com")).rejects.toThrow(/nenhum usuário/i);
  });

  it("não expõe o papel de admin na resposta do app", async () => {
    await registrar("dono@teste.com");
    await grantAdmin("dono@teste.com");
    const { senha } = { senha: "senha-bem-longa" };

    const login = await request(app)
      .post("/auth/login")
      .send({ email: "dono@teste.com", password: senha });

    // O app não precisa saber quem administra — publicUser segue sem role.
    expect(login.body.user.role).toBeUndefined();
  });
});

// Por último de propósito: o rateLimit guarda o bucket em memória, por IP.
// Estourar a janela aqui deixaria todo teste seguinte tomando 429.
describe("Proteção contra força bruta", () => {
  it("segura tentativa repetida de login no painel", async () => {
    await registrar("dono@teste.com");
    const mesmoIp = ipNovo(); // insistir do MESMO IP é o que precisa ser barrado
    let ultimo = 0;
    for (let i = 0; i < 7; i++) {
      ultimo = (await entrarNoPainel("dono@teste.com", "chute-errado-longo", mesmoIp)).status;
    }
    expect(ultimo).toBe(429);
  });
});

describe("Sessão do painel depois de trocar a senha", () => {
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it("entra de novo com a senha nova e o token FUNCIONA", async () => {
    const email = "chefe-trocou@teste.com";
    const u = await registrar(email);
    await grantAdmin(email, { force: true });

    await request(app)
      .patch("/auth/password")
      .set(auth(u.token))
      .set("X-Forwarded-For", ipNovo())
      .send({ atual: u.senha, nova: "senha-nova-bem-longa" })
      .expect(200);

    const sessao = await entrarNoPainel(email, "senha-nova-bem-longa");
    expect(sessao.status).toBe(200);

    // O ponto do teste é este. O login SEMPRE respondeu 200; o que estava
    // quebrado era a requisição seguinte — o token do painel nascia sem o
    // campo de versão, então qualquer versão diferente de zero o matava na
    // hora. Quem trocasse a senha ficava trancado fora do painel para sempre,
    // porque entrar de novo emitia outro token igualmente natimorto.
    const usando = await request(app)
      .get("/admin/users")
      .set(auth(sessao.body.data.token as string));
    expect(usando.status).toBe(200);
  });

  it("a sessão antiga do painel cai quando a senha muda", async () => {
    const email = "chefe-sessao@teste.com";
    const u = await registrar(email);
    await grantAdmin(email, { force: true });
    const antiga = (await entrarNoPainel(email, u.senha)).body.data.token as string;

    expect((await request(app).get("/admin/users").set(auth(antiga))).status).toBe(200);

    await request(app)
      .patch("/auth/password")
      .set(auth(u.token))
      .set("X-Forwarded-For", ipNovo())
      .send({ atual: u.senha, nova: "outra-senha-bem-longa" })
      .expect(200);

    // Trocar a senha tem que expulsar quem estava dentro, painel inclusive.
    expect((await request(app).get("/admin/users").set(auth(antiga))).status).toBe(401);
  });
});
