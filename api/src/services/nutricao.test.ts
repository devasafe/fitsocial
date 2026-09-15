import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Plan } from "../models/Plan.js";
import { FoodLog } from "../models/FoodLog.js";
import { alvosPorDia, evolucaoDeNutricao } from "./nutricao.js";
import { chaveDoDia } from "../utils/dia.js";

let mongod: MongoMemoryServer;
const user = new mongoose.Types.ObjectId();

/** O "hoje" do servidor, no mesmo fuso em que o FoodLog e gravado. */
const r_hoje = () => chaveDoDia();

const dieta = (kcal: number) => ({
  dailyCalories: kcal,
  macros: { proteinG: 150, carbsG: 200, fatG: 60 },
  meals: [{ name: "Café", timeHint: "", items: [{ food: "Ovos", quantity: "2" }] }],
  notes: "",
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Plan.deleteMany({});
});

describe("O alvo que valia em cada dia", () => {
  it("dia anterior a qualquer dieta nao tem alvo", async () => {
    await Plan.create({
      user, version: 1, summary: "plano", workout: null, diet: dieta(2000),
      disclaimer: "aviso", createdAt: new Date("2026-09-10T12:00:00Z"),
    });

    const alvos = await alvosPorDia(user, ["2026-09-08", "2026-09-11"]);

    expect(alvos.get("2026-09-08")).toBeNull();
    expect(alvos.get("2026-09-11")?.kcal).toBe(2000);
  });

  it("meta que mudou no meio da janela nao reescreve o passado", async () => {
    await Plan.create({
      user, version: 1, summary: "plano", workout: null, diet: dieta(2000),
      disclaimer: "aviso", createdAt: new Date("2026-09-01T12:00:00Z"),
    });
    await Plan.create({
      user, version: 2, summary: "plano", workout: null, diet: dieta(1700),
      disclaimer: "aviso", createdAt: new Date("2026-09-10T12:00:00Z"),
    });

    const alvos = await alvosPorDia(user, ["2026-09-05", "2026-09-10", "2026-09-12"]);

    // O dia 5 foi vivido com meta de 2000: julgá-lo por 1700 seria inventar uma
    // falha que nao aconteceu.
    expect(alvos.get("2026-09-05")?.kcal).toBe(2000);
    expect(alvos.get("2026-09-10")?.kcal).toBe(1700);
    expect(alvos.get("2026-09-12")?.kcal).toBe(1700);
  });

  it("plano sem dieta nao conta como troca de alvo", async () => {
    await Plan.create({
      user, version: 1, summary: "plano", workout: null, diet: dieta(2000),
      disclaimer: "aviso", createdAt: new Date("2026-09-01T12:00:00Z"),
    });
    // Prescricao de treino: cria versao nova e PRESERVA a dieta (routes/pro.ts).
    await Plan.create({
      user, version: 2, summary: "plano", workout: { split: "AB", daysPerWeek: 2, sessions: [] },
      diet: null, disclaimer: "aviso", createdAt: new Date("2026-09-05T12:00:00Z"),
    });

    expect((await alvosPorDia(user, ["2026-09-07"])).get("2026-09-07")?.kcal).toBe(2000);
  });

  it("nao enxerga a dieta de outra pessoa", async () => {
    await Plan.create({
      user: new mongoose.Types.ObjectId(), version: 1, summary: "plano", workout: null,
      diet: dieta(3000), disclaimer: "aviso", createdAt: new Date("2026-09-01T12:00:00Z"),
    });

    expect((await alvosPorDia(user, ["2026-09-07"])).get("2026-09-07")).toBeNull();
  });
});

describe("A serie de dias", () => {
  const registrar = (date: string, kcal: number) =>
    FoodLog.create({ user, date, meal: "almoco", name: "arroz", kcal, proteinG: 10, carbsG: 20, fatG: 5 });

  beforeEach(async () => {
    await FoodLog.deleteMany({});
  });

  it("devolve um item por dia da janela, inclusive os vazios", async () => {
    const r = await evolucaoDeNutricao(user, 7);
    expect(r.dias).toHaveLength(7);
    expect(r.resumo.diasNaJanela).toBe(7);
  });

  it("dia sem registro vem NULL, e nao zero", async () => {
    // Zero e uma afirmacao sobre a comida; null e a ausencia de afirmacao. O
    // grafico precisa da diferenca para nao dizer que a pessoa passou fome.
    const r = await evolucaoDeNutricao(user, 7);
    const vazio = r.dias[0]!;
    expect(vazio.kcal).toBeNull();
    expect(vazio.registros).toBe(0);
  });

  it("soma os registros do mesmo dia", async () => {
    const hoje = r_hoje();
    await registrar(hoje, 300);
    await registrar(hoje, 200);

    const r = await evolucaoDeNutricao(user, 7);
    const dia = r.dias.find((d) => d.dia === hoje)!;

    expect(dia.kcal).toBe(500);
    expect(dia.proteinG).toBe(20);
    expect(dia.registros).toBe(2);
  });

  it("a media ignora os dias vazios, e o resumo diz quantos foram", async () => {
    await registrar(r_hoje(), 400);

    const r = await evolucaoDeNutricao(user, 30);

    // 400, e nao 400/30: a media de um dia apresentada como se fosse de trinta e
    // a mentira que esta tela existe para evitar.
    expect(r.resumo.mediaKcal).toBe(400);
    expect(r.resumo.diasComRegistro).toBe(1);
  });

  it("media e null quando nao houve registro nenhum", async () => {
    const r = await evolucaoDeNutricao(user, 7);
    expect(r.resumo.mediaKcal).toBeNull();
  });

  it("nao mistura o diario de outra pessoa", async () => {
    await FoodLog.create({
      user: new mongoose.Types.ObjectId(), date: r_hoje(), meal: "almoco",
      name: "alheio", kcal: 9999, proteinG: 0, carbsG: 0, fatG: 0,
    });

    const r = await evolucaoDeNutricao(user, 7);
    expect(r.dias.every((d) => d.kcal === null)).toBe(true);
  });
});
