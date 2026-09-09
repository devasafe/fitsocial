import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../models/User.js";
import { Activity } from "../models/Activity.js";
import { Post } from "../models/Post.js";
import { UserDailyActive } from "../models/UserDailyActive.js";
import { panorama, retencao, ativosPorDia } from "./growthMetrics.js";
import { chaveDoDia, ultimosDias } from "../utils/dia.js";
import { marcarPresenca } from "./presence.js";

let mongod: MongoMemoryServer;
const DIA = 24 * 60 * 60 * 1000;

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
    User.deleteMany({}), Activity.deleteMany({}),
    Post.deleteMany({}), UserDailyActive.deleteMany({}),
  ]);
});

/** Cria usuário com data de cadastro controlada.
 *  Vai pelo driver nativo porque o Mongoose descarta escrita em createdAt
 *  (o update sai vazio e volta acknowledged:false). */
async function usuario(email: string, criadoEm = new Date()) {
  const u = await User.create({ name: "Fulano", email, passwordHash: "x" });
  await User.collection.updateOne({ _id: u._id }, { $set: { createdAt: criadoEm } });
  return u;
}

describe("Fuso horário", () => {
  it("conta o cadastro das 22h de São Paulo no dia certo, não no seguinte", () => {
    // 2026-09-10T01:00:00Z é 2026-09-09 às 22h em São Paulo.
    const madrugadaUTC = new Date("2026-09-10T01:00:00.000Z");
    expect(chaveDoDia(madrugadaUTC)).toBe("2026-09-09");
  });

  it("vira o dia à meia-noite de São Paulo, não à de Londres", () => {
    // 03:00 UTC = 00:00 em São Paulo.
    expect(chaveDoDia(new Date("2026-09-10T02:59:00.000Z"))).toBe("2026-09-09");
    expect(chaveDoDia(new Date("2026-09-10T03:01:00.000Z"))).toBe("2026-09-10");
  });

  it("a série de novos usuários usa o dia de São Paulo", async () => {
    await usuario("noite@teste.com", new Date("2026-09-10T01:00:00.000Z"));
    const dias = ultimosDias(400);
    expect(dias).toContain("2026-09-09");
  });
});

describe("Presença", () => {
  it("marca um acesso por dia, mesmo com várias requisições", async () => {
    const u = await usuario("ativo@teste.com");
    const doc = (await User.findById(u._id))!;

    await marcarPresenca(doc);
    await marcarPresenca(doc); // dentro da janela: não escreve de novo

    expect(await UserDailyActive.countDocuments({ user: u._id })).toBe(1);
  });

  it("não escreve de novo antes de dez minutos", async () => {
    const u = await usuario("ativo@teste.com");
    const doc = (await User.findById(u._id))!;

    await marcarPresenca(doc);
    const primeiro = doc.lastSeenAt;

    // Cinco minutos depois ainda é cedo demais para outra escrita.
    await marcarPresenca(doc, new Date(Date.now() + 5 * 60 * 1000));
    expect(doc.lastSeenAt).toBe(primeiro);

    // Onze minutos depois, sim.
    await marcarPresenca(doc, new Date(Date.now() + 11 * 60 * 1000));
    expect(doc.lastSeenAt).not.toBe(primeiro);
  });
});

describe("Ativos por dia", () => {
  it("separa quem registrou algo de quem só abriu o app", async () => {
    const escritor = await usuario("escreveu@teste.com");
    const visitante = await usuario("so-abriu@teste.com");
    const hoje = chaveDoDia();

    await Activity.create({
      user: escritor._id, sportId: "musculacao", kind: "strength",
      title: "Treino", startedAt: new Date(), durationSec: 3600, payload: {},
    });
    await UserDailyActive.create({ user: visitante._id, dia: hoje });

    const serie = await ativosPorDia(7);
    const deHoje = serie.find((s) => s.dia === hoje)!;

    expect(deHoje.registraram).toBe(1); // só o escritor
    expect(deHoje.abriram).toBe(1); // só o visitante
  });

  it("conta a pessoa uma vez por dia, mesmo com vários registros", async () => {
    const u = await usuario("prolifico@teste.com");
    for (let i = 0; i < 3; i++) {
      await Activity.create({
        user: u._id, sportId: "corrida", kind: "endurance",
        title: "Corrida", startedAt: new Date(), durationSec: 1800, payload: {},
      });
    }

    const serie = await ativosPorDia(7);
    expect(serie.find((s) => s.dia === chaveDoDia())!.registraram).toBe(1);
  });

  it("devolve todos os dias da janela, inclusive os vazios", async () => {
    const serie = await ativosPorDia(7);
    expect(serie).toHaveLength(7);
    expect(serie.every((s) => s.registraram === 0 && s.abriram === 0)).toBe(true);
  });
});

describe("Retenção", () => {
  it("conta quem voltou no dia seguinte", async () => {
    const ontem = new Date(Date.now() - 2 * DIA);
    const u = await usuario("voltou@teste.com", ontem);

    // Ativo exatamente um dia depois de se cadastrar.
    await UserDailyActive.create({ user: u._id, dia: chaveDoDia(new Date(ontem.getTime() + DIA)) });

    const r = await retencao();
    expect(r.base.d1).toBe(1);
    expect(r.d1).toBe(100);
  });

  it("não penaliza quem se cadastrou ontem na retenção de 30 dias", async () => {
    await usuario("novato@teste.com", new Date(Date.now() - DIA));

    const r = await retencao();
    // Ainda não teve 30 dias para voltar, então nem entra na base.
    expect(r.base.d30).toBe(0);
    expect(r.d30).toBe(0);
  });

  it("conta como perdido quem não voltou", async () => {
    await usuario("sumiu@teste.com", new Date(Date.now() - 3 * DIA));

    const r = await retencao();
    expect(r.base.d1).toBe(1);
    expect(r.d1).toBe(0);
  });
});

describe("Panorama", () => {
  it("responde com tudo, mesmo num banco vazio", async () => {
    const p = await panorama(30);

    expect(p.totais.contas).toBe(0);
    expect(p.series.novos).toHaveLength(30);
    expect(p.conversao.taxa).toBe(0);
    expect(p.conversao.ativacao).toBe(0);
    expect(p.acessoDesde).toBeNull();
  });

  it("calcula ativação e conversão", async () => {
    const a = await usuario("treinou@teste.com");
    await usuario("nunca-treinou@teste.com");
    await User.updateOne({ _id: a._id }, { $set: { tier: "premium", premiumSource: "admin" } });
    await Activity.create({
      user: a._id, sportId: "musculacao", kind: "strength",
      title: "Treino", startedAt: new Date(), durationSec: 3600, payload: {},
    });

    const p = await panorama(30);

    expect(p.totais.contas).toBe(2);
    expect(p.conversao.ativacao).toBe(50); // 1 de 2 registrou treino
    expect(p.conversao.taxa).toBe(50); // 1 de 2 é premium
    expect(p.conversao.porOrigem).toEqual([{ origem: "admin", total: 1 }]);
  });

  it("informa desde quando a medição de acesso existe", async () => {
    const u = await usuario("alguem@teste.com");
    await UserDailyActive.create({ user: u._id, dia: "2026-09-01" });
    await UserDailyActive.create({ user: u._id, dia: "2026-09-05" });

    const p = await panorama(30);
    expect(p.acessoDesde).toBe("2026-09-01");
  });
});
