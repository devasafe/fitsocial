import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { User, type UserDoc } from "../models/User.js";
import { Activity } from "../models/Activity.js";
import { ProfessionalLink } from "../models/ProfessionalLink.js";
import { ProfessionalInvite } from "../models/ProfessionalInvite.js";
import { aceitarConvite, ajustarEscopo, encerrarVinculo, gerarConvite } from "./vinculos.js";
import {
  filtroDeAtividadesVisiveis,
  podarRotaSePrivada,
  podeVerAtividade,
} from "./activityVisibility.js";

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
  await Promise.all([
    User.deleteMany({}),
    Activity.deleteMany({}),
    ProfessionalLink.deleteMany({}),
    ProfessionalInvite.deleteMany({}),
  ]);
});

let n = 0;
async function pessoa(campos: Record<string, unknown> = {}): Promise<UserDoc> {
  n++;
  return User.create({ name: `P${n}`, email: `v${n}@teste.com`, passwordHash: "x", ...campos });
}

/** Um coach com um aluno que já aceitou. Devolve os dois e o vínculo. */
async function dupla(escopo: Record<string, boolean> = {}) {
  const coach = await pessoa({ pro: { coach: { ativo: true, origem: "manual" } } });
  const aluno = await pessoa();
  const { code } = await gerarConvite(coach, "coach");
  const link = await aceitarConvite(aluno, code, escopo);
  return { coach, aluno, link };
}

async function treinoPrivado(dono: UserDoc) {
  return Activity.create({
    user: dono._id,
    sportId: "musculacao",
    kind: "strength",
    startedAt: new Date(),
    visibility: "private",
    payload: { variant: "musculacao", exercises: [{ name: "Supino", sets: [{ type: "valida", weightKg: 80, reps: 5 }] }] },
    metrics: {},
  });
}

describe("o profissional e os treinos do aluno", () => {
  // O caso que o painel existe para resolver: sem isto, o coach veria só o
  // treino que a pessoa tornou público e teria de perguntar o resto no zap.
  it("vê até o treino privado de quem o aceitou", async () => {
    const { coach, aluno } = await dupla();
    const treino = await treinoPrivado(aluno);

    expect(await podeVerAtividade(treino, coach._id)).toBe(true);
  });

  it("e a vitrine do aluno não fica vazia para ele", async () => {
    const { coach, aluno } = await dupla();
    await treinoPrivado(aluno);

    // O aluno nunca ligou `activitiesPublic`: para qualquer outra pessoa, o
    // filtro não casa com nada.
    const filtro = await filtroDeAtividadesVisiveis(aluno._id, coach._id);
    expect(await Activity.countDocuments(filtro)).toBe(1);

    const estranho = await pessoa();
    const filtroEstranho = await filtroDeAtividadesVisiveis(aluno._id, estranho._id);
    expect(await Activity.countDocuments(filtroEstranho)).toBe(0);
  });

  it("o acesso é de mão única: o aluno não vê os treinos do coach", async () => {
    const { coach, aluno } = await dupla();
    const treinoDoCoach = await treinoPrivado(coach);

    expect(await podeVerAtividade(treinoDoCoach, aluno._id)).toBe(false);
  });

  it("outro coach, sem vínculo, não vê nada", async () => {
    const { aluno } = await dupla();
    const outro = await pessoa({ pro: { coach: { ativo: true, origem: "manual" } } });
    const treino = await treinoPrivado(aluno);

    expect(await podeVerAtividade(treino, outro._id)).toBe(false);
  });

  it("aluno que fechou os treinos no escopo deixa de ser visível", async () => {
    const { coach, aluno, link } = await dupla();
    const treino = await treinoPrivado(aluno);

    await ajustarEscopo(aluno, link._id.toString(), { treinos: false });

    expect(await podeVerAtividade(treino, coach._id)).toBe(false);
    const filtro = await filtroDeAtividadesVisiveis(aluno._id, coach._id);
    expect(await Activity.countDocuments(filtro)).toBe(0);
  });

  it("encerrado o acompanhamento, o acesso acaba na hora", async () => {
    const { coach, aluno, link } = await dupla();
    const treino = await treinoPrivado(aluno);

    await encerrarVinculo(aluno, link._id.toString());

    expect(await podeVerAtividade(treino, coach._id)).toBe(false);
  });

  // Ver o treino é uma coisa; saber de que porta a pessoa sai para correr todo
  // dia é outra, e ela não foi perguntada sobre isso.
  it("a rota de GPS continua podada para o profissional", async () => {
    const { coach, aluno } = await dupla();
    const payload = { distanceM: 5000, points: [{ lat: -23.5, lng: -46.6 }], polyline: "abc" };

    const paraOCoach = await podarRotaSePrivada(payload, aluno._id, coach._id);

    expect(paraOCoach.distanceM).toBe(5000);
    expect(paraOCoach).not.toHaveProperty("points");
    expect(paraOCoach).not.toHaveProperty("polyline");
  });

  // O ajuste que liberava a rota foi aposentado. O campo pode continuar
  // gravado em contas antigas, e não vale mais nada — é este teste que impede
  // alguém de voltar a respeitá-lo sem perceber.
  it("nem o ajuste antigo devolve a rota para o profissional", async () => {
    const { coach, aluno } = await dupla();
    aluno.set("settings.routesPublic", true);
    await aluno.save();

    const payload = { distanceM: 5000, points: [{ lat: -23.5, lng: -46.6 }] };
    const paraOCoach = await podarRotaSePrivada(payload, aluno._id, coach._id);

    expect(paraOCoach).not.toHaveProperty("points");
    expect(paraOCoach.distanceM).toBe(5000);
  });

  it("o dono continua vendo o próprio percurso", async () => {
    const { aluno } = await dupla();
    const payload = { distanceM: 5000, points: [{ lat: -23.5, lng: -46.6 }] };

    const paraEleMesmo = await podarRotaSePrivada(payload, aluno._id, aluno._id);

    expect(paraEleMesmo).toHaveProperty("points");
  });
});
