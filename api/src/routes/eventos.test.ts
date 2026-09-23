import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { AppEvent } from "../models/AppEvent.js";

const app = createApp();
let mongod: MongoMemoryServer;

async function registrar(name: string, email: string) {
  const r = await request(app)
    .post("/auth/register")
    .send({ name, email, password: "senha12345" });
  return { token: r.body.token as string, id: r.body.user.id as string };
}

let ana = { token: "", id: "" };

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), AppEvent.deleteMany({})]);
  ana = await registrar("Ana", "ana@teste.com");
});

function comToken(token: string) {
  return request(app).post("/events").set("Authorization", `Bearer ${token}`);
}

describe("POST /events", () => {
  it("grava os eventos do lote e diz quantos aceitou", async () => {
    const res = await comToken(ana.token).send({
      eventos: [
        { nome: "onboarding_abriu" },
        { nome: "onboarding_saiu", props: { campos: 4 } },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.aceitos).toBe(2);

    const gravados = await AppEvent.find({}).sort({ criadoEm: 1 }).lean();
    expect(gravados.map((e) => e.nome)).toEqual(["onboarding_abriu", "onboarding_saiu"]);
    expect(gravados[1].props).toEqual({ campos: 4 });
  });

  it("amarra o evento a quem está autenticado, ignorando o usuário mandado no corpo", async () => {
    const bruno = await registrar("Bruno", "bruno@teste.com");

    await comToken(ana.token).send({
      eventos: [{ nome: "home_viu", props: { estado: "sem_plano" } }],
      user: bruno.id,
    });

    const gravado = await AppEvent.findOne({ nome: "home_viu" }).lean();
    expect(String(gravado?.user)).toBe(ana.id);
  });

  // Nome desconhecido é o app NOVO falando com o servidor VELHO — acontece em
  // todo deploy, já que o app sobe antes ou depois da API. Derrubar o lote
  // inteiro por causa disso perderia também os eventos que o servidor entende.
  it("ignora nome fora da lista fechada sem perder o resto do lote", async () => {
    const res = await comToken(ana.token).send({
      eventos: [
        { nome: "treino_salvo" },
        { nome: "inventado_pelo_app_do_futuro" },
        { nome: "story_abriu" },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.aceitos).toBe(2);
    expect(res.body.data.ignorados).toBe(1);

    const nomes = (await AppEvent.find({}).lean()).map((e) => e.nome).sort();
    expect(nomes).toEqual(["story_abriu", "treino_salvo"]);
  });

  // O contrário do caso acima: props malformada é erro de quem escreveu o app,
  // não evolução de versão. Falhar alto aqui é o que impede texto livre de
  // entrar em telemetria sem ninguém perceber.
  it("recusa o lote quando uma propriedade passa do tamanho permitido", async () => {
    const res = await comToken(ana.token).send({
      eventos: [{ nome: "home_viu", props: { estado: "x".repeat(200) } }],
    });

    expect(res.status).toBe(400);
    expect(await AppEvent.countDocuments({})).toBe(0);
  });

  it("recusa lote maior que o teto", async () => {
    const res = await comToken(ana.token).send({
      eventos: Array.from({ length: 101 }, () => ({ nome: "home_viu" })),
    });

    expect(res.status).toBe(400);
    expect(await AppEvent.countDocuments({})).toBe(0);
  });

  it("exige autenticação", async () => {
    const res = await request(app)
      .post("/events")
      .send({ eventos: [{ nome: "home_viu" }] });

    expect(res.status).toBe(401);
    expect(await AppEvent.countDocuments({})).toBe(0);
  });
});
