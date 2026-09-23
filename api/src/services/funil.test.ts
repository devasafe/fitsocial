import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User } from "../models/User.js";
import { AppEvent } from "../models/AppEvent.js";
import { funilDePercurso } from "./funil.js";

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
  await Promise.all([User.deleteMany({}), AppEvent.deleteMany({})]);
});

const DIA_MS = 24 * 60 * 60 * 1000;

async function criarPessoa(nome: string, diasAtras = 0) {
  const u = await User.create({
    name: nome,
    email: `${nome}@teste.com`,
    passwordHash: "x",
  });
  if (diasAtras > 0) {
    // Pelo driver, e não pelo mongoose: com `timestamps: true` o `createdAt` é
    // IMUTÁVEL, e um `updateOne` sobre ele é descartado sem erro — o teste
    // passaria a medir outra coisa sem ninguém perceber.
    await User.collection.updateOne(
      { _id: u._id },
      { $set: { createdAt: new Date(Date.now() - diasAtras * DIA_MS) } }
    );
  }
  return u;
}

async function evento(user: mongoose.Types.ObjectId, nome: string) {
  await AppEvent.create({ user, nome });
}

function degrau(funil: { nome: string; pessoas: number }[], nome: string) {
  return funil.find((d) => d.nome === nome)?.pessoas;
}

describe("funilDePercurso", () => {
  it("conta PESSOAS por degrau, não eventos", async () => {
    const ana = await criarPessoa("ana");
    await evento(ana._id, "home_viu");
    await evento(ana._id, "home_viu");
    await evento(ana._id, "home_viu");

    const f = await funilDePercurso(30);

    expect(degrau(f, "home_viu")).toBe(1);
  });

  it("usa como base quem se cadastrou dentro da janela", async () => {
    const dentro = await criarPessoa("dentro", 5);
    const fora = await criarPessoa("fora", 60);
    await evento(dentro._id, "treino_salvo");
    await evento(fora._id, "treino_salvo");

    const f = await funilDePercurso(30);

    expect(degrau(f, "cadastrou")).toBe(1);
    // A pessoa de fora da janela não pode aparecer num degrau posterior: é
    // assim que uma taxa de passagem passa de 100% e o funil deixa de fazer
    // sentido.
    expect(degrau(f, "treino_salvo")).toBe(1);
  });

  it("devolve os degraus na ordem do percurso, começando pelo cadastro", async () => {
    await criarPessoa("ana");

    const f = await funilDePercurso(30);

    expect(f[0].nome).toBe("cadastrou");
    expect(f.map((d) => d.nome)).toEqual([
      "cadastrou",
      "onboarding_abriu",
      "onboarding_concluiu",
      "home_viu",
      "registrar_abriu",
      "treino_salvo",
      "concluido_viu",
      "compartilhar_tocou",
      "card_gerado",
      "story_abriu",
    ]);
  });

  it("dá a cada degrau um rótulo legível para o painel", async () => {
    await criarPessoa("ana");

    const f = await funilDePercurso(30);

    expect(f[0].rotulo).toBeTruthy();
    expect(f.every((d) => typeof d.rotulo === "string" && d.rotulo.length > 0)).toBe(true);
  });

  it("não quebra quando ninguém se cadastrou na janela", async () => {
    const f = await funilDePercurso(30);

    expect(degrau(f, "cadastrou")).toBe(0);
    expect(degrau(f, "treino_salvo")).toBe(0);
  });
});
