import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { AiUsage } from "../models/AiUsage.js";
import { installAiTelemetry, usagePorChave, usagePorDia } from "./aiUsage.js";
import { GeminiProvider } from "./ai/gemini.js";
import { setAiTelemetrySink } from "./ai/telemetry.js";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await AiUsage.deleteMany({});
});

afterEach(() => {
  setAiTelemetrySink(null);
  vi.unstubAllGlobals();
});

/** Espera o insert em segundo plano do sink (é fire-and-forget de propósito). */
async function aguardarGravacao() {
  for (let i = 0; i < 40; i++) {
    if ((await AiUsage.countDocuments({})) > 0) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("Persistência da telemetria de IA", () => {
  it("grava a chamada no banco quando a telemetria está instalada", async () => {
    installAiTelemetry();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "oi" }] } }],
          usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3, totalTokenCount: 10 },
        }),
      }) as unknown as Response)
    );

    const userId = new mongoose.Types.ObjectId().toString();
    await new GeminiProvider("k", "gemini-2.5-flash", { keyLabel: "gemini#1", chainIndex: 0 }).generate({
      messages: [{ role: "user", content: "oi" }],
      feature: "coach",
      userId,
    });

    await aguardarGravacao();
    const doc = await AiUsage.findOne({});
    expect(doc).not.toBeNull();
    expect(doc!.totalTokens).toBe(10);
    expect(doc!.keyLabel).toBe("gemini#1");
    expect(doc!.feature).toBe("coach");
    expect(doc!.user?.toString()).toBe(userId);
    expect(doc!.ok).toBe(true);
  });

  it("ignora userId que não é ObjectId em vez de estourar", async () => {
    installAiTelemetry();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: "oi" }] } }] }),
      }) as unknown as Response)
    );

    await new GeminiProvider("k", "m").generate({
      messages: [{ role: "user", content: "oi" }],
      userId: "nao-sou-um-id",
    });

    await aguardarGravacao();
    const doc = await AiUsage.findOne({});
    expect(doc).not.toBeNull();
    expect(doc!.user).toBeUndefined();
  });
});

describe("Retenção e identificação da chave", () => {
  it("cria o índice TTL para o detalhe não crescer sem fim", async () => {
    await AiUsage.init(); // garante que o Mongoose sincronizou os índices
    const indices = await AiUsage.collection.indexes();
    const ttl = indices.find((i) => i.expireAfterSeconds !== undefined);

    expect(ttl).toBeDefined();
    expect(ttl!.key).toMatchObject({ createdAt: 1 });
    expect(ttl!.expireAfterSeconds).toBe(180 * 24 * 60 * 60);
  });

  it("guarda a impressão digital da chave, nunca a chave", async () => {
    installAiTelemetry();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: "oi" }] } }] }),
      }) as unknown as Response)
    );

    await new GeminiProvider("chave-super-secreta", "m", {
      keyLabel: "gemini#1",
      chainIndex: 0,
      keyFingerprint: "a1b2c3d4",
    }).generate({ messages: [{ role: "user", content: "oi" }] });

    await aguardarGravacao();
    const doc = await AiUsage.findOne({});
    expect(doc!.keyFingerprint).toBe("a1b2c3d4");
    expect(JSON.stringify(doc!.toObject())).not.toContain("chave-super-secreta");
  });
});

describe("Agregações para o painel", () => {
  it("soma tokens e falhas por chave, e traz o limite configurado", async () => {
    await AiUsage.create([
      { provider: "gemini", model: "m", keyLabel: "gemini#1", ok: true, totalTokens: 100 },
      { provider: "gemini", model: "m", keyLabel: "gemini#1", ok: false, errorKind: "quota", totalTokens: 0 },
      { provider: "groq", model: "l", keyLabel: "groq#1", ok: true, totalTokens: 50 },
    ]);

    const linhas = await usagePorChave();
    const g1 = linhas.find((l) => l.keyLabel === "gemini#1")!;

    expect(g1.chamadas).toBe(2);
    expect(g1.falhas).toBe(1);
    expect(g1.tokens).toBe(100);
    expect(linhas.find((l) => l.keyLabel === "groq#1")!.tokens).toBe(50);
    // Sem AI_DAILY_LIMITS no ambiente de teste, o teto vem nulo.
    expect(g1.limiteDiario).toBeNull();
  });

  it("agrupa a série por dia", async () => {
    const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await AiUsage.create([
      { provider: "gemini", model: "m", keyLabel: "gemini#1", ok: true, totalTokens: 10 },
      { provider: "gemini", model: "m", keyLabel: "gemini#1", ok: true, totalTokens: 20 },
    ]);
    await AiUsage.collection.insertOne({
      provider: "gemini", model: "m", keyLabel: "gemini#1", chainIndex: 0,
      ok: true, totalTokens: 5, promptTokens: 0, completionTokens: 0, latencyMs: 0,
      createdAt: ontem, updatedAt: ontem,
    });

    const serie = await usagePorDia(7);
    expect(serie).toHaveLength(2);
    expect(serie[0].tokens).toBe(5); // ontem
    expect(serie[1].tokens).toBe(30); // hoje
  });

  it("não conta o que está fora da janela pedida", async () => {
    const antigo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    await AiUsage.collection.insertOne({
      provider: "gemini", model: "m", keyLabel: "gemini#1", chainIndex: 0,
      ok: true, totalTokens: 999, promptTokens: 0, completionTokens: 0, latencyMs: 0,
      createdAt: antigo, updatedAt: antigo,
    });

    expect(await usagePorDia(7)).toHaveLength(0);
  });
});
