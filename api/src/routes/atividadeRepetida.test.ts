import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { Activity } from "../models/Activity.js";
import { Post } from "../models/Post.js";

// Cobre o modelo (Tarefa 2): a chave do envio e a impressão do conteúdo, com
// os índices que tornam a detecção de duplicata possível. Cresce na Tarefa 3
// com os testes de rota (o endpoint de registrar treino usando essa chave).
const app = createApp();
let mongod: MongoMemoryServer;
const userId = new mongoose.Types.ObjectId();

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Um agente HTTP já autenticado. */
function como(token: string) {
  return { post: (path: string) => request(app).post(path).set(auth(token)) };
}

let n = 0;
async function registrar(): Promise<{ token: string; id: string }> {
  n++;
  const r = await request(app)
    .post("/auth/register")
    .send({ name: `Rep${n}`, email: `rep${n}@teste.com`, password: "senha12345" });
  return { token: r.body.token, id: r.body.user.id };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Activity.init(); // garante que o Mongoose sincronizou os índices
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("Activity: clientKey e impressao", () => {
  it("duas atividades do mesmo usuário não podem ter a mesma clientKey", async () => {
    const base = {
      user: userId,
      sportId: "musculacao",
      kind: "strength" as const,
      startedAt: new Date(),
      durationSec: 60,
      visibility: "private" as const,
      payload: {},
      metrics: {},
      disclaimer: undefined,
    };
    await Activity.create({ ...base, clientKey: "k1" });
    await expect(Activity.create({ ...base, clientKey: "k1" })).rejects.toThrow();
  });

  it("atividades SEM clientKey continuam podendo coexistir", async () => {
    // Todo treino que já existe em produção não tem chave. Um índice único que
    // não seja esparso recusaria o segundo deles.
    const base = {
      user: userId,
      sportId: "musculacao",
      kind: "strength" as const,
      startedAt: new Date(),
      durationSec: 60,
      visibility: "private" as const,
      payload: {},
      metrics: {},
    };
    await Activity.create(base);
    await expect(Activity.create(base)).resolves.toBeTruthy();
  });
});

describe("POST /activities: o servidor reconhece o mesmo treino enviado duas vezes", () => {
  // Um usuário novo por teste: os `toBe(N)` do brief contam as atividades
  // DESTA pessoa, e só ficam exatos se ela não carregar treino de um teste
  // anterior (o arquivo inteiro divide o mesmo MongoMemoryServer).
  let token = "";
  let idDoUsuario = "";
  let tokenDeOutro = "";

  beforeEach(async () => {
    const eu = await registrar();
    token = eu.token;
    idDoUsuario = eu.id;
    tokenDeOutro = (await registrar()).token;
  });

  it("o mesmo envio duas vezes cria UM treino, e o segundo devolve o primeiro", async () => {
    const corpo = {
      sportId: "musculacao",
      kind: "strength",
      durationSec: 3600,
      clientKey: "sessao-1",
      payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] },
    };

    const um = await como(token).post("/activities").send(corpo).expect(201);
    const dois = await como(token).post("/activities").send(corpo).expect(200);

    expect(dois.body.data.id).toBe(um.body.data.id);
    expect(dois.body.meta.repetido).toBe(true);
    expect(await Activity.countDocuments({ user: idDoUsuario })).toBe(1);
  });

  it("sem chave, o mesmo conteúdo em menos de 10 minutos também não duplica", async () => {
    // É o caso do APK instalado, que não manda chave nenhuma.
    const corpo = {
      sportId: "musculacao",
      kind: "strength",
      durationSec: 3600,
      payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] },
    };

    await como(token).post("/activities").send(corpo).expect(201);
    const dois = await como(token).post("/activities").send(corpo).expect(200);

    expect(dois.body.meta.repetido).toBe(true);
    expect(await Activity.countDocuments({ user: idDoUsuario })).toBe(1);
  });

  it("`mesmoAssim` grava o segundo, para quem treinou duas vezes de verdade", async () => {
    const corpo = {
      sportId: "musculacao",
      kind: "strength",
      durationSec: 3600,
      payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] },
    };

    await como(token).post("/activities").send(corpo).expect(201);
    await como(token).post("/activities").send({ ...corpo, mesmoAssim: true }).expect(201);

    expect(await Activity.countDocuments({ user: idDoUsuario })).toBe(2);
  });

  it("conteúdo diferente no mesmo minuto grava os dois", async () => {
    // A rede compara CONTEÚDO, não horário: dois treinos diferentes seguidos são
    // dois treinos, e recusá-los seria pior que a duplicata que ela evita.
    const base = { sportId: "musculacao", kind: "strength", durationSec: 3600 };
    await como(token)
      .post("/activities")
      .send({ ...base, payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] } })
      .expect(201);
    await como(token)
      .post("/activities")
      .send({ ...base, payload: { exercises: [{ name: "Agachamento", sets: [{ weightKg: 100, reps: 5 }] }] } })
      .expect(201);

    expect(await Activity.countDocuments({ user: idDoUsuario })).toBe(2);
  });

  it("o mesmo conteúdo DEPOIS da janela grava normalmente", async () => {
    const corpo = {
      sportId: "musculacao",
      kind: "strength",
      durationSec: 3600,
      payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] },
    };
    const um = await como(token).post("/activities").send(corpo).expect(201);
    // `overwriteImmutable`: desde o Mongoose 5, `createdAt` gerado por
    // `timestamps: true` é imutável por padrão — um `$set` comum é
    // descartado em silêncio (sem erro, sem efeito). Só assim o teste
    // realmente empurra o treino para fora da janela.
    await Activity.updateOne(
      { _id: um.body.data.id },
      { $set: { createdAt: new Date(Date.now() - 20 * 60_000) } },
      { timestamps: false, overwriteImmutable: true }
    );

    await como(token).post("/activities").send(corpo).expect(201);
    expect(await Activity.countDocuments({ user: idDoUsuario })).toBe(2);
  });

  it("a repetição NÃO cria um segundo post no feed", async () => {
    const corpo = {
      sportId: "musculacao",
      kind: "strength",
      durationSec: 3600,
      clientKey: "sessao-2",
      shareToFeed: true,
      caption: "bora",
      payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] },
    };
    await como(token).post("/activities").send(corpo).expect(201);
    await como(token).post("/activities").send(corpo).expect(200);
    expect(await Post.countDocuments({ author: idDoUsuario })).toBe(1);
  });

  it("a chave é por PESSOA: mesma chave de outra conta não colide", async () => {
    const corpo = {
      sportId: "musculacao",
      kind: "strength",
      durationSec: 3600,
      // 8+ caracteres: é o mínimo que o schema exige (min(8) em clientKey).
      clientKey: "mesma-chave",
      payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] },
    };
    await como(token).post("/activities").send(corpo).expect(201);
    await como(tokenDeOutro).post("/activities").send(corpo).expect(201);
    expect(await Activity.countDocuments({ clientKey: "mesma-chave" })).toBe(2);
  });

  // `sessionDay` (dentro de `planLink`) é CONTEÚDO, não metadado: duas sessões
  // do plano com os mesmos exercícios são dois treinos diferentes, e o mesmo
  // `sessionDay` reenviado é o mesmo treino. Documenta a regra para ninguém
  // "simplificar" a impressão tirando `planLink` de volta — foi assim que o
  // check-in de duas sessões distintas, feito em sequência, colidia em
  // produção antes desta correção (ver ranking de `gamification.test.ts`).
  it("sessionDay diferente, mesmos exercícios: /checkins grava DOIS treinos", async () => {
    const entries = [{ exerciseName: "Supino", weightKg: 40, reps: 10 }];
    await como(token).post("/checkins").send({ sessionDay: "Dia A", entries }).expect(201);
    await como(token).post("/checkins").send({ sessionDay: "Dia B", entries }).expect(201);
    expect(await Activity.countDocuments({ user: idDoUsuario })).toBe(2);
  });

  it("mesmo sessionDay reenviado: /checkins grava UM treino só", async () => {
    const entries = [{ exerciseName: "Supino", weightKg: 40, reps: 10 }];
    const um = await como(token).post("/checkins").send({ sessionDay: "Dia A", entries }).expect(201);
    expect(um.body.repetido).toBeFalsy();
    const dois = await como(token).post("/checkins").send({ sessionDay: "Dia A", entries }).expect(200);
    expect(dois.body.repetido).toBe(true);
    expect(await Activity.countDocuments({ user: idDoUsuario })).toBe(1);
  });
});
