import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Plan } from "../models/Plan.js";
import { FoodLog } from "../models/FoodLog.js";
import { alvosPorDia, evolucaoDeNutricao } from "./nutricao.js";
import { chaveDoDia, ultimosDias } from "../utils/dia.js";

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

/**
 * A costura entre as duas metades: o alvo certo no dia certo.
 *
 * `alvosPorDia` e `evolucaoDeNutricao` sao bem cobertos cada um de um lado —
 * um pelo historico de meta, outro pelos totais. O que ninguem olhava era o
 * ponto onde eles se encontram, que e justamente o numero de destaque da tela.
 */
describe("Dias dentro da meta", () => {
  const DIA = 24 * 60 * 60 * 1000;
  const atras = (dias: number) => new Date(Date.now() - dias * DIA);

  const registrar = (date: string, kcal: number) =>
    FoodLog.create({ user, date, meal: "almoco", name: "arroz", kcal, proteinG: 10, carbsG: 20, fatG: 5 });

  beforeEach(async () => {
    await FoodLog.deleteMany({});
  });

  it("a tolerancia e de 10% para cada lado, e o dia carrega o alvo dele", async () => {
    await Plan.create({
      user, version: 1, summary: "plano", workout: null, diet: dieta(2000),
      disclaimer: "aviso", createdAt: atras(20),
    });

    const datas = ultimosDias(7);
    await registrar(datas[6]!, 2000); // em cima da meta
    await registrar(datas[5]!, 2180); // 9% acima: ainda e o dia dela
    await registrar(datas[4]!, 2400); // 20% acima: fora

    const r = await evolucaoDeNutricao(user, 7);

    expect(r.resumo.diasDentroDoAlvo).toBe(2);
    // O alvo viaja junto de cada dia: e ele que a tela usa para explicar o
    // numero, e sem ele "2 de 3" seria um numero sem origem.
    expect(r.dias[6]!.alvo?.kcal).toBe(2000);
    expect(r.dias[5]!.alvo?.kcal).toBe(2000);
    expect(r.dias[4]!.alvo?.kcal).toBe(2000);
  });

  it("cada dia e julgado contra o alvo DELE, e nao contra o mais recente", async () => {
    // A tese inteira da feature. Sem isto, quem baixa a meta transforma em
    // falha um mes de dias que foram acertos.
    await Plan.create({
      user, version: 1, summary: "plano", workout: null, diet: dieta(2000),
      disclaimer: "aviso", createdAt: atras(40),
    });
    await Plan.create({
      user, version: 2, summary: "plano", workout: null, diet: dieta(1600),
      disclaimer: "aviso", createdAt: atras(5),
    });

    const datas = ultimosDias(30);
    await registrar(datas[10]!, 2000); // vivido sob 2000: acerto
    await registrar(datas[26]!, 1600); // ja sob 1600: acerto
    await registrar(datas[28]!, 2000); // o mesmo 2000 de antes, agora 25% fora

    const r = await evolucaoDeNutricao(user, 30);

    expect(r.dias[10]!.alvo?.kcal).toBe(2000);
    expect(r.dias[26]!.alvo?.kcal).toBe(1600);
    expect(r.dias[28]!.alvo?.kcal).toBe(1600);
    expect(r.resumo.diasDentroDoAlvo).toBe(2);
    expect(r.resumo.diasComRegistro).toBe(3);
  });

  it("a janela comeca onde diz que comeca: o dia anterior fica de fora", async () => {
    await Plan.create({
      user, version: 1, summary: "plano", workout: null, diet: dieta(2000),
      disclaimer: "aviso", createdAt: atras(20),
    });

    const datas = ultimosDias(7);
    const vespera = ultimosDias(8)[0]!; // o dia imediatamente anterior a janela
    expect(vespera).not.toBe(datas[0]);

    await registrar(datas[0]!, 2000);
    await registrar(vespera, 9999);

    const r = await evolucaoDeNutricao(user, 7);

    // O primeiro dia da janela entra inteiro...
    expect(r.dias[0]!.dia).toBe(datas[0]);
    expect(r.dias[0]!.kcal).toBe(2000);
    // ...e a vespera nao vaza por nenhuma borda: nem na serie, nem na media,
    // nem na contagem de acertos.
    expect(r.dias.some((d) => d.dia === vespera)).toBe(false);
    expect(r.resumo.diasComRegistro).toBe(1);
    expect(r.resumo.mediaKcal).toBe(2000);
    expect(r.resumo.diasDentroDoAlvo).toBe(1);
  });
});
