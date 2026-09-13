import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../models/User.js";
import { diagnosticarDireitos } from "./diagnosticarDireitos.js";

// O script que roda ANTES do merge, contra um dump de produção. Se ele mentir,
// mente justamente no momento em que se está decidindo tirar acesso de gente
// real — então ele tem teste como qualquer outra coisa.

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

let n = 0;
async function criar(campos: Record<string, unknown> = {}) {
  n += 1;
  return User.create({
    name: `Pessoa ${n}`,
    email: `p${n}@teste.com`,
    passwordHash: "x",
    ...campos,
  });
}

describe("diagnóstico de direitos", () => {
  it("conta quem está de pé só pelo ramo de legado", async () => {
    // Premium sem nenhuma origem gravada: o ramo de legado segura essa conta
    // para não rebaixar quem pagou na época em que o webhook só escrevia
    // `tier`. Ela NÃO muda de plano — mas precisa ser carimbada pelo backfill,
    // e é este número que diz quando o ramo pode sair do motor.
    await criar({ tier: "premium" });

    const r = await diagnosticarDireitos();

    expect(r.total).toBe(1);
    expect(r.dependemDoLegado).toBe(1);
    expect(r.perdemAcesso).toBe(0);
    expect(r.mudariam).toHaveLength(0);
  });

  it("aponta a cortesia vencida, dizendo a data", async () => {
    await criar({
      tier: "premium",
      premiumSource: "admin",
      premiumUntil: new Date("2020-01-15"),
    });

    const r = await diagnosticarDireitos();

    expect(r.perdemAcesso).toBe(1);
    expect(r.mudariam[0].porque).toContain("VENCIDA");
    expect(r.mudariam[0].porque).toContain("2020-01-15");
  });

  it("não acusa mudança em quem está certo", async () => {
    await criar({ tier: "free" });
    await criar({
      tier: "premium",
      plan: "pro",
      premiumSource: "admin",
      premiumUntil: new Date(Date.now() + 86_400_000),
    });

    const r = await diagnosticarDireitos();

    expect(r.total).toBe(2);
    expect(r.mudariam).toHaveLength(0);
  });

  it("aponta quem GANHA acesso — o aluno acompanhado", async () => {
    await criar({ tier: "free", vinculosPatrocinados: 1 });

    const r = await diagnosticarDireitos();

    expect(r.ganhamAcesso).toBe(1);
    expect(r.mudariam[0].para).toBe("pro");
    expect(r.mudariam[0].porque).toContain("acompanhado");
  });

  it("mascara o e-mail — a saída não pode virar lista de contatos", async () => {
    await criar({
      email: "asafe.silva@gmail.com",
      tier: "premium",
      premiumSource: "admin",
      premiumUntil: new Date("2020-01-01"),
    });

    const r = await diagnosticarDireitos();

    // Primeira letra e domínio, como o `maskEmail` do projeto: dá para
    // reconhecer quem é sem a saída virar uma lista de contatos.
    expect(r.mudariam[0].email).toBe("a***@gmail.com");
    expect(r.mudariam[0].email).not.toContain("silva");
  });
});
