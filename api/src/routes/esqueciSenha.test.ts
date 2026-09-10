import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { PasswordReset } from "../models/PasswordReset.js";
import { setMailer, type Mensagem } from "../services/mail/index.js";
import { TENTATIVAS_MAX, VALIDADE_MS } from "../services/passwordReset.js";

const app = createApp();
let mongod: MongoMemoryServer;

/** O provider é o limite: o que importa provar é o que foi mandado, e para quem. */
const caixaDeEntrada: Mensagem[] = [];

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  setMailer({
    name: "teste",
    enviar: async (m) => {
      caixaDeEntrada.push(m);
    },
  });
});

afterAll(async () => {
  setMailer(null);
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), PasswordReset.deleteMany({})]);
  caixaDeEntrada.length = 0;
});

const SENHA = "senha-bem-longa";
const NOVA = "outra-senha-bem-longa";
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let n = 0;
let ipSeq = 0;
const ip = () => `198.18.2.${++ipSeq}`;

async function registrar() {
  n += 1;
  const email = `p${n}@teste.com`;
  const r = await request(app)
    .post("/auth/register")
    .send({ name: `Pessoa ${n}`, email, password: SENHA });
  return { token: r.body.token as string, id: new mongoose.Types.ObjectId(r.body.user.id), email };
}

const esqueci = (email: string) =>
  request(app).post("/auth/forgot-password").set("X-Forwarded-For", ip()).send({ email });

const redefinir = (email: string, codigo: string, nova = NOVA) =>
  request(app).post("/auth/reset-password").set("X-Forwarded-For", ip()).send({ email, codigo, nova });

/** O código só existe no e-mail — é de lá que o teste o tira, como a pessoa faria. */
function codigoDoEmail(): string {
  const m = caixaDeEntrada.at(-1)!.texto.match(/\b(\d{6})\b/);
  return m![1];
}

describe("Pedir o código", () => {
  it("manda o código para quem tem conta", async () => {
    const u = await registrar();

    await esqueci(u.email).expect(200);

    expect(caixaDeEntrada).toHaveLength(1);
    expect(caixaDeEntrada[0].para).toBe(u.email);
    expect(codigoDoEmail()).toMatch(/^\d{6}$/);
  });

  it("responde IGUAL para e-mail que não existe", async () => {
    const u = await registrar();

    const comConta = await esqueci(u.email);
    const semConta = await esqueci("ninguem@lugar-nenhum.com");

    // Responder diferente transformaria a rota numa lista de quem tem conta.
    expect(semConta.status).toBe(comConta.status);
    expect(semConta.body).toEqual(comConta.body);
    expect(caixaDeEntrada).toHaveLength(1); // e nenhum e-mail saiu
  });

  it("não guarda o código, só o hash dele", async () => {
    const u = await registrar();
    await esqueci(u.email);

    const pedido = await PasswordReset.findOne({ user: u.id });

    // Quem puser a mão no banco leva hashes, não contas.
    expect(pedido!.codeHash).not.toContain(codigoDoEmail());
    expect(pedido!.codeHash.startsWith("$2")).toBe(true);
  });

  it("pedir de novo invalida o código anterior", async () => {
    const u = await registrar();
    await esqueci(u.email);
    const primeiro = codigoDoEmail();
    await esqueci(u.email);
    const segundo = codigoDoEmail();

    expect(await PasswordReset.countDocuments({ user: u.id })).toBe(1);
    // Senão cada pedido deixaria mais uma chave viva por quinze minutos.
    if (primeiro !== segundo) await redefinir(u.email, primeiro).expect(400);
    await redefinir(u.email, segundo).expect(200);
  });

  it("conta banida não redefine senha", async () => {
    const u = await registrar();
    await User.updateOne({ _id: u.id }, { $set: { status: "banned" } });

    await esqueci(u.email).expect(200);

    // Deixar passar seria contornar o banimento por e-mail.
    expect(caixaDeEntrada).toHaveLength(0);
  });

  it("segura pedidos repetidos do mesmo lugar", async () => {
    const u = await registrar();
    const mesmoIp = ip();
    let ultimo = 0;
    for (let i = 0; i < 7; i++) {
      ultimo = (
        await request(app)
          .post("/auth/forgot-password")
          .set("X-Forwarded-For", mesmoIp)
          .send({ email: u.email })
      ).status;
    }
    expect(ultimo).toBe(429);
  });
});

describe("Usar o código", () => {
  it("troca a senha e já devolve a pessoa logada", async () => {
    const u = await registrar();
    await esqueci(u.email);

    const r = await redefinir(u.email, codigoDoEmail()).expect(200);

    expect((await request(app).get("/auth/me").set(auth(r.body.data.token))).status).toBe(200);
    expect((await request(app).post("/auth/login").send({ email: u.email, password: NOVA })).status).toBe(200);
    expect((await request(app).post("/auth/login").send({ email: u.email, password: SENHA })).status).toBe(401);
  });

  it("derruba as sessões que já estavam abertas", async () => {
    const u = await registrar();
    await esqueci(u.email);

    await redefinir(u.email, codigoDoEmail()).expect(200);

    // "Esqueci a senha" muitas vezes quer dizer "alguém entrou na minha conta".
    const antigo = await request(app).get("/auth/me").set(auth(u.token));
    expect(antigo.status).toBe(401);
  });

  it("o código serve uma vez só", async () => {
    const u = await registrar();
    await esqueci(u.email);
    const codigo = codigoDoEmail();

    await redefinir(u.email, codigo).expect(200);
    await redefinir(u.email, codigo, "terceira-senha-longa").expect(400);
  });

  it("morre depois de tentativas demais, mesmo dentro do prazo", async () => {
    const u = await registrar();
    await esqueci(u.email);
    const certo = codigoDoEmail();
    const errado = certo === "000000" ? "111111" : "000000";

    for (let i = 0; i < TENTATIVAS_MAX; i++) {
      await redefinir(u.email, errado).expect(400);
    }

    // Seis dígitos são um milhão de combinações — um script vence isso em
    // minutos se ninguém contar as tentativas.
    await redefinir(u.email, certo).expect(400);
  });

  it("não aceita código vencido", async () => {
    const u = await registrar();
    await esqueci(u.email);
    const codigo = codigoDoEmail();

    await PasswordReset.updateOne(
      { user: u.id },
      { $set: { expiresAt: new Date(Date.now() - VALIDADE_MS) } }
    );

    await redefinir(u.email, codigo).expect(400);
  });

  it("a mensagem de erro não diz se o e-mail tem conta", async () => {
    const u = await registrar();
    await esqueci(u.email);

    const codigoErrado = await redefinir(u.email, "000000");
    const emailSemConta = await redefinir("ninguem@lugar-nenhum.com", "000000");

    // Um "esse código expirou" já confirma que o e-mail está cadastrado.
    expect(emailSemConta.body.error).toBe(codigoErrado.body.error);
  });

  it("recusa senha nova curta e código fora do formato", async () => {
    const u = await registrar();
    await esqueci(u.email);
    const codigo = codigoDoEmail();

    expect((await redefinir(u.email, codigo, "curta")).status).toBe(400);
    expect((await redefinir(u.email, "12345")).status).toBe(400);
    // A senha curta não pode ter gastado o código.
    await redefinir(u.email, codigo).expect(200);
  });
});
