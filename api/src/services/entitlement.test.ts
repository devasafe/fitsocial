import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User, publicUser } from "../models/User.js";
import { calcularPlan, calcularTier, planDoUsuario, recomputeTier, temCapacidade } from "./entitlement.js";

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
  await User.deleteMany({});
});

async function criar(campos: Record<string, unknown> = {}) {
  return User.create({
    name: "Pessoa",
    email: `p${Math.random().toString(36).slice(2)}@teste.com`,
    passwordHash: "x",
    ...campos,
  });
}

describe("plano do consumidor", () => {
  it("conta nova nasce free", async () => {
    const u = await criar();
    expect(planDoUsuario(u)).toBe("free");
    expect(calcularTier(u)).toBe("free");
  });

  // A razão de `planDoUsuario` existir: quem já paga tem `tier: premium` e não
  // tem `plan`. Derivar do tier é o que impede o deploy de rebaixar essa gente.
  it("conta antiga premium, sem plan, é lida como pro", async () => {
    const u = await criar();
    await User.collection.updateOne(
      { _id: u._id },
      { $set: { tier: "premium", premiumSource: "purchase" }, $unset: { plan: "" } }
    );
    const antigo = (await User.findById(u._id))!;

    expect(antigo.plan).toBeUndefined();
    expect(planDoUsuario(antigo)).toBe("pro");
    expect(calcularTier(antigo)).toBe("premium");
  });

  it("pro e pro_plus continuam sendo premium para quem lê tier", async () => {
    for (const plan of ["pro", "pro_plus"] as const) {
      const u = await criar({ plan, premiumSource: "purchase" });
      expect(calcularTier(u)).toBe("premium");
      expect(publicUser(u).tier).toBe("premium");
      expect(publicUser(u).plan).toBe(plan);
    }
  });

  it("cortesia do admin ganha do que veio da loja", async () => {
    const u = await criar({ plan: "free", premiumSource: "admin" });
    expect(calcularPlan(u)).toBe("pro");
    expect(calcularTier(u)).toBe("premium");
  });

  it("cortesia vencida volta para free", async () => {
    const u = await criar({
      plan: "pro",
      premiumSource: "admin",
      premiumUntil: new Date(Date.now() - 1000),
      tier: "premium",
    });
    await recomputeTier(u);

    expect(u.plan).toBe("free");
    expect(u.tier).toBe("free");
    expect(u.premiumSource).toBeNull();
  });

  it("recompute não rebaixa quem tem compra ativa", async () => {
    const u = await criar({ plan: "pro_plus", premiumSource: "purchase", tier: "premium" });
    await recomputeTier(u);

    expect(u.plan).toBe("pro_plus");
    expect(u.tier).toBe("premium");
  });
});

describe("capacidade profissional", () => {
  it("ninguém nasce coach nem nutri", async () => {
    const u = await criar();
    expect(temCapacidade(u, "coach")).toBe(false);
    expect(temCapacidade(u, "nutri")).toBe(false);
    expect(publicUser(u).pro).toEqual({ coach: false, nutri: false });
  });

  it("capacidade ativa vale, e o prazo é respeitado", async () => {
    const ativo = await criar({ pro: { coach: { ativo: true, origem: "manual" } } });
    expect(temCapacidade(ativo, "coach")).toBe(true);
    expect(temCapacidade(ativo, "nutri")).toBe(false);

    const vencido = await criar({
      pro: { coach: { ativo: true, origem: "manual", validoAte: new Date(Date.now() - 1000) } },
    });
    expect(temCapacidade(vencido, "coach")).toBe(false);
  });

  // Os três eixos são independentes: um coach pode ser aluno free, e um
  // admin não vira coach por ser admin.
  it("capacidade não depende do plano nem do papel", async () => {
    const coachFree = await criar({ plan: "free", pro: { coach: { ativo: true } } });
    expect(temCapacidade(coachFree, "coach")).toBe(true);
    expect(calcularTier(coachFree)).toBe("free");

    const admin = await criar({ role: "admin" });
    expect(temCapacidade(admin, "coach")).toBe(false);
  });

  it("dá para ser coach e nutri ao mesmo tempo", async () => {
    const u = await criar({ pro: { coach: { ativo: true }, nutri: { ativo: true } } });
    expect(temCapacidade(u, "coach")).toBe(true);
    expect(temCapacidade(u, "nutri")).toBe(true);
  });

  it("o teto de alunos nasce em 10 e vive no documento", async () => {
    const u = await criar({ pro: { coach: { ativo: true } } });
    expect(u.pro?.coach?.limiteDeAlunos).toBe(10);

    const excecao = await criar({ pro: { coach: { ativo: true, limiteDeAlunos: 50 } } });
    expect(excecao.pro?.coach?.limiteDeAlunos).toBe(50);
  });
});
