import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Activity } from "../models/Activity.js";

// Cobre o modelo (Tarefa 2): a chave do envio e a impressão do conteúdo, com
// os índices que tornam a detecção de duplicata possível. Cresce na Tarefa 3
// com os testes de rota (o endpoint de registrar treino usando essa chave).
let mongod: MongoMemoryServer;
const userId = new mongoose.Types.ObjectId();

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
