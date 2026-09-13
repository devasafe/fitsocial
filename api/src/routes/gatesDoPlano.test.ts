import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { User } from "../models/User.js";
import { Activity } from "../models/Activity.js";
import { PersonalRecord } from "../models/PersonalRecord.js";
import { PersonalRecordEvent } from "../models/PersonalRecordEvent.js";
import { Plan } from "../models/Plan.js";
import { setAIProvider } from "../services/ai/index.js";
import type { AIProvider } from "../services/ai/provider.js";

// A linha entre o grátis e o Pro, num arquivo só.
//
// Ela mora espalhada pelas rotas por necessidade, mas o que ela É precisa caber
// numa leitura — senão daqui a três meses ninguém sabe dizer o que o grátis
// tem sem abrir seis arquivos.

const app = createApp();
let mongod: MongoMemoryServer;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const DIA = 24 * 60 * 60 * 1000;

const PLANO = JSON.stringify({
  summary: "Plano de teste",
  workout: {
    split: "Full body",
    daysPerWeek: 3,
    sessions: [
      {
        day: "A",
        focus: "Geral",
        exercises: [{ name: "Agachamento", sets: 3, reps: "10", restSeconds: 60, notes: "" }],
      },
    ],
  },
  // `planDataSchema` exige a dieta: devolver `null` fazia o importador recusar
  // e a rota responder 502 — que a asserção fraca (`not.toBe(402)`) escondia.
  diet: {
    dailyCalories: 2000,
    macros: { proteinG: 150, carbsG: 200, fatG: 60 },
    meals: [{ name: "Café", timeHint: "07:00", items: [{ food: "Ovos", quantity: "3" }] }],
    notes: "",
  },
  disclaimer: "Aviso.",
});

/** Dublê: importar plano é chamada de IA, e teste não fala com modelo real. */
class IaDeMentira implements AIProvider {
  readonly name = "mock";
  readonly aceitaImagem = false;
  async generate(): Promise<string> {
    return PLANO;
  }
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  setAIProvider(new IaDeMentira());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Activity.deleteMany({}),
    PersonalRecord.deleteMany({}),
    PersonalRecordEvent.deleteMany({}),
    Plan.deleteMany({}),
  ]);
});

let n = 0;
async function registrar(pago = false) {
  n += 1;
  const r = await request(app)
    .post("/auth/register")
    .send({ name: `P${n}`, email: `g${n}@teste.com`, password: "senha-bem-longa" });

  if (pago) {
    // Cortesia sem prazo: uma fonte legítima, e não `tier` cru — o motor
    // recalcularia por cima de um `tier` sem origem.
    await User.updateOne(
      { _id: r.body.user.id },
      { $set: { premiumSource: "admin", premiumUntil: null } }
    );
  }
  return { token: r.body.token as string, id: r.body.user.id as string };
}

/** Um treino de força numa data escolhida, pela API, como o app faz. */
async function treino(token: string, peso: number, diasAtras: number) {
  await request(app)
    .post("/activities")
    .set(auth(token))
    .send({
      sportId: "musculacao",
      kind: "strength",
      startedAt: new Date(Date.now() - diasAtras * DIA).toISOString(),
      durationSec: 3600,
      payload: {
        variant: "musculacao",
        exercises: [{ name: "Supino reto", sets: [{ type: "valida", weightKg: peso, reps: 5 }] }],
      },
    });
}

describe("a evolução do grátis para nos últimos 7 dias", () => {
  it("a janela longa é cortada, e a resposta diz que cortou", async () => {
    const u = await registrar();

    const r = await request(app).get("/evolucao/exercicios?dias=365").set(auth(u.token));

    expect(r.status).toBe(200);
    expect(r.body.meta.dias).toBe(7);
    expect(r.body.meta.diasPedidos).toBe(365);
    expect(r.body.meta.limitadoPor).toBe("plano");
  });

  it('"tudo" (zero) também é cortado — é o caso que mais precisa', async () => {
    const u = await registrar();

    const r = await request(app).get("/evolucao/exercicios?dias=0").set(auth(u.token));

    expect(r.body.meta.dias).toBe(7);
  });

  it("e corta de verdade: o treino de 30 dias atrás não aparece", async () => {
    const u = await registrar();
    await treino(u.token, 80, 30);
    await treino(u.token, 90, 2);

    const r = await request(app).get("/evolucao/exercicios?dias=365").set(auth(u.token));

    // Uma vez, e não duas: o de 30 dias ficou fora da semana.
    expect(r.body.data[0].vezes).toBe(1);
  });

  it("quem paga recebe a janela que pediu", async () => {
    const u = await registrar(true);
    await treino(u.token, 80, 30);
    await treino(u.token, 90, 2);

    const r = await request(app).get("/evolucao/exercicios?dias=365").set(auth(u.token));

    expect(r.body.meta.dias).toBe(365);
    expect(r.body.meta.limitadoPor).toBeUndefined();
    expect(r.body.data[0].vezes).toBe(2);
  });

  it("a curva de um exercício também é cortada", async () => {
    const u = await registrar();
    await treino(u.token, 80, 30);
    await treino(u.token, 90, 2);

    const r = await request(app)
      .get("/evolucao/exercicios/supino_reto?dias=365")
      .set(auth(u.token));

    expect(r.body.meta.dias).toBe(7);
    expect(r.body.meta.limitadoPor).toBe("plano");
    // Um ponto, não dois: o treino de 30 dias ficou fora.
    expect(r.body.data).toHaveLength(1);
  });

  it("a curva de cardio também", async () => {
    const u = await registrar();

    const r = await request(app).get("/evolucao/cardio/corrida?dias=365").set(auth(u.token));

    expect(r.body.meta.dias).toBe(7);
    expect(r.body.meta.limitadoPor).toBe("plano");
  });

  it("corta, e NÃO recusa — 402 aqui tiraria o app velho do gráfico", async () => {
    const u = await registrar();

    // O aplicativo instalado navega para a tela de assinatura ao ver 402. Numa
    // tela de gráfico, que nunca foi ligada a paywall, isso seria a pessoa
    // sendo expulsa do que estava olhando sem entender por quê.
    for (const rota of [
      "/evolucao/exercicios?dias=365",
      "/evolucao/grupos?dias=365",
      "/evolucao/cardio?dias=365",
    ]) {
      expect((await request(app).get(rota).set(auth(u.token))).status).toBe(200);
    }
  });
});

describe("o que é Pro por inteiro, e o que fica livre", () => {
  it("o calendário do ano é Pro, mas responde 200 vazio — nunca 402", async () => {
    const u = await registrar();

    const r = await request(app).get("/evolucao/calendario").set(auth(u.token));

    // 402 aqui chegaria como erro em toda tela do aplicativo instalado, e o
    // card "Seu ano" sumiria calado. 200 com `limitadoPor` deixa o app novo
    // desenhar o cadeado e o antigo degradar sem exceção em voo.
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
    expect(r.body.meta.limitadoPor).toBe("plano");
  });

  it("e vem cheio para quem paga", async () => {
    const u = await registrar(true);
    const r = await request(app).get("/evolucao/calendario").set(auth(u.token));
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBe(365);
    expect(r.body.meta.limitadoPor).toBeUndefined();
  });

  it("os recordes ATUAIS ficam livres — é o laço que traz a pessoa de volta", async () => {
    const u = await registrar();
    await treino(u.token, 80, 1);

    const r = await request(app).get("/prs").set(auth(u.token));

    expect(r.status).toBe(200);
  });

  it("mas a linha do tempo das conquistas para na semana", async () => {
    // Três treinos: o primeiro é linha de base e não gera conquista nenhuma —
    // é preciso uma SUBIDA fora da semana para haver o que cortar.
    const u = await registrar();
    await treino(u.token, 80, 40);
    await treino(u.token, 90, 30);
    await treino(u.token, 100, 1);

    const r = await request(app).get("/prs/historico").set(auth(u.token));

    expect(r.status).toBe(200);
    expect(r.body.meta.limitadoPor).toBe("plano");
    // Um treino gera vários tipos de recorde (carga, 1RM, faixa), então o que
    // importa não é a contagem: é que NADA de fora da semana voltou.
    const limite = Date.now() - 7 * DIA;
    expect(r.body.data.length).toBeGreaterThan(0);
    for (const c of r.body.data as { achievedAt: string }[]) {
      expect(new Date(c.achievedAt).getTime()).toBeGreaterThan(limite);
    }

    // E quem paga vê a linha inteira, com as duas subidas.
    const pago = await registrar(true);
    await treino(pago.token, 80, 40);
    await treino(pago.token, 90, 30);
    await treino(pago.token, 100, 1);
    const doPago = await request(app).get("/prs/historico").set(auth(pago.token));
    expect(doPago.body.data.length).toBeGreaterThan(r.body.data.length);
  });
});

describe("a IA só cria, não reescreve", () => {
  it("importar OUTRO plano é Pro — era o furo por onde o grátis passava", async () => {
    const u = await registrar();
    // Já tem plano: o primeiro é de graça, e é o SEGUNDO que a regra cobra.
    // Semeado direto, sem passar pela IA — o que se testa aqui é o gate.
    await Plan.create({
      user: u.id,
      version: 1,
      summary: "Plano que já existia",
      workout: { split: "AB", daysPerWeek: 2, sessions: [] },
      disclaimer: "x",
    });

    const r = await request(app)
      .post("/plans/import")
      .set(auth(u.token))
      .send({ text: "Treino B: terra 4x8, remada 4x10" });

    // 402 ANTES de chamar a IA: o furo não era só de dinheiro, era de custo —
    // uma conta grátis disparava chamada de modelo sem limite por aqui.
    expect(r.status).toBe(402);
    expect(r.body.error).toContain("Pro");
  });

  it("mas o PRIMEIRO plano importado continua de graça", async () => {
    const u = await registrar();

    const r = await request(app)
      .post("/plans/import")
      .set(auth(u.token))
      .send({ text: "Treino A: supino 4x10" });

    // Passa do gate e cria de verdade.
    expect(r.status).toBe(201);
  });
});
