import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Activity } from "../models/Activity.js";
import { PersonalRecord } from "../models/PersonalRecord.js";
import { estimate1RM, repRangeFor, detectStrengthPRs, detectPRs, crossedMilestone } from "./prEngine.js";

let mongod: MongoMemoryServer;
const userId = new mongoose.Types.ObjectId();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
beforeEach(async () => {
  await PersonalRecord.deleteMany({});
  await Activity.deleteMany({});
});

async function logExercicio(name: string, weightKg: number, reps: number) {
  const activity = await Activity.create({
    user: userId,
    sportId: "musculacao",
    kind: "strength",
    startedAt: new Date(),
    payload: {
      variant: "musculacao",
      exercises: [{ name, sets: [{ type: "valida", weightKg, reps, done: true }] }],
    },
    metrics: {},
  });
  return detectStrengthPRs(userId, activity);
}

async function logSupino(weightKg: number, reps: number) {
  const activity = await Activity.create({
    user: userId,
    sportId: "musculacao",
    kind: "strength",
    startedAt: new Date(),
    payload: {
      variant: "musculacao",
      exercises: [{ name: "Supino", sets: [{ type: "valida", weightKg, reps, done: true }] }],
    },
    metrics: {},
  });
  return detectStrengthPRs(userId, activity);
}

describe("estimate1RM (Epley)", () => {
  it("estima 1RM só para 1–12 reps", () => {
    expect(estimate1RM(100, 5)).toBeCloseTo(100 * (1 + 5 / 30));
    expect(estimate1RM(100, 1)).toBeCloseTo(100 * (1 + 1 / 30));
    expect(estimate1RM(100, 13)).toBeNull();
    expect(estimate1RM(100, 0)).toBeNull();
  });
});

describe("repRangeFor", () => {
  it("classifica a faixa de repetições", () => {
    expect(repRangeFor(2)).toBe("1-3");
    expect(repRangeFor(6)).toBe("4-6");
    expect(repRangeFor(10)).toBe("7-10");
    expect(repRangeFor(15)).toBe("11-15");
    expect(repRangeFor(20)).toBeNull();
  });
});

describe("detectStrengthPRs", () => {
  it("primeira vez é linha de base: registra o PR mas não celebra", async () => {
    const news = await logSupino(60, 8);
    expect(news).toHaveLength(0); // nada celebrado
    const cargaMax = await PersonalRecord.findOne({ exerciseName: "Supino", type: "carga_max" });
    expect(cargaMax?.value).toBe(60);
  });

  it("celebra quando bate a carga máxima com margem real, guardando o anterior", async () => {
    await logSupino(60, 8);
    const news = await logSupino(65, 6);
    const cargaMaxPR = news.find((p) => p.type === "carga_max");
    expect(cargaMaxPR).toBeTruthy();
    expect(cargaMaxPR?.value).toBe(65);
    expect(cargaMaxPR?.previousValue).toBe(60);
  });

  it("não celebra melhora abaixo do limiar (0,5 kg / 1%)", async () => {
    await logSupino(100, 5);
    const news = await logSupino(100.3, 5); // +0,3 kg < 1 kg (1%)
    expect(news.find((p) => p.type === "carga_max")).toBeUndefined();
    // mas o número foi atualizado silenciosamente
    const pr = await PersonalRecord.findOne({ exerciseName: "Supino", type: "carga_max" });
    expect(pr?.value).toBeCloseTo(100.3);
  });

  it("detecta 1RM estimado como recorde próprio", async () => {
    await logSupino(60, 8); // baseline 1RM ~76
    const news = await logSupino(80, 5); // 1RM ~93.3 > baseline
    expect(news.find((p) => p.type === "rm_estimado")).toBeTruthy();
  });
});

async function logCorrida(distanceM: number, durationSec: number) {
  const activity = await Activity.create({
    user: userId,
    sportId: "corrida",
    kind: "endurance",
    startedAt: new Date(),
    durationSec,
    payload: { distanceM },
    metrics: {},
  });
  return detectPRs(userId, activity);
}

describe("detectPRs — endurance (manual)", () => {
  it("celebra melhor tempo por alvo quando fica mais rápido", async () => {
    const first = await logCorrida(5000, 1500); // 5k em 25:00 — linha de base
    expect(first).toHaveLength(0);
    const faster = await logCorrida(5000, 1400); // 5k em 23:20
    expect(faster.some((p) => p.type === "best_time" && p.repRange === "5k")).toBe(true);
  });

  it("celebra maior distância", async () => {
    await logCorrida(5000, 1500); // linha de base
    const longer = await logCorrida(9000, 2700);
    expect(longer.some((p) => p.type === "best_dist")).toBe(true);
  });
});

async function logWod(
  over: { tempoSec?: number; nivel?: string; tamanhoDoTime?: number } = {}
) {
  const activity = await Activity.create({
    user: userId,
    sportId: "crossfit",
    kind: "wod",
    startedAt: new Date(),
    payload: {
      v: 3,
      tamanhoDoTime: over.tamanhoDoTime ?? 1,
      blocos: [
        {
          modo: "21-15-9",
          nome: "Fran",
          movimentos: [
            { nome: "Thruster", volume: { valor: [21, 15, 9], unidade: "reps" }, escopo: "individual" },
          ],
          resultado: { tipo: "tempo", tempoSec: over.tempoSec ?? 300 },
          escala: { nivel: over.nivel ?? "rx" },
        },
      ],
    },
    metrics: {},
  });
  return detectPRs(userId, activity);
}

describe("detectPRs — wod", () => {
  it("celebra melhor tempo de benchmark e separa por nível", async () => {
    await logWod({ tempoSec: 300 }); // baseline Rx
    const faster = await logWod({ tempoSec: 270 }); // Rx mais rápido
    expect(faster.some((p) => p.type === "wod_time" && p.repRange === "rx")).toBe(true);

    // Scaled é recorde SEPARADO — primeiro scaled é linha de base, não celebra.
    const scaled = await logWod({ nivel: "scaled", tempoSec: 400 });
    expect(scaled).toHaveLength(0);
  });

  it("treino de dupla não concorre com o individual", async () => {
    await logWod({ tempoSec: 300 });

    // Tempo muito melhor, mas a dois. Deixar competir derrubaria o recorde de
    // quem fez o treino inteiro sozinho.
    const dupla = await logWod({ tempoSec: 180, tamanhoDoTime: 2 });
    expect(dupla.filter((p) => p.type === "wod_time")).toEqual([]);
  });
});

describe("marcos de aula (class)", () => {
  it("crossedMilestone detecta o limiar cruzado", () => {
    expect(crossedMilestone("aulas", 49, 50)).toBe(50);
    expect(crossedMilestone("aulas", 50, 51)).toBeNull();
    expect(crossedMilestone("aulas", 98, 260)).toBe(250); // pega o maior cruzado
  });

  it("acumula aulas e horas sem celebrar abaixo do primeiro marco", async () => {
    for (let i = 0; i < 3; i++) {
      await Activity.create({
        user: userId,
        sportId: "jiu_jitsu",
        kind: "class",
        startedAt: new Date(),
        durationSec: 3600,
        payload: { modality: "jiu_jitsu" },
        metrics: {},
      }).then((a) => detectPRs(userId, a));
    }
    const aulas = await PersonalRecord.findOne({ exerciseName: "jiu_jitsu", type: "aulas" });
    expect(aulas?.value).toBe(3);
    const horas = await PersonalRecord.findOne({ exerciseName: "jiu_jitsu", type: "horas" });
    expect(horas?.value).toBe(3); // 3 x 3600s = 3h
  });
});

describe("identidade do exercício (slug)", () => {
  // O bug que isto conserta: o recorde era chaveado pelo nome cru, então cada
  // jeito de escrever "supino reto" criava um recorde próprio — e a evolução da
  // pessoa aparecia picada em vários históricos do mesmo exercício.
  it("junta o mesmo exercício escrito de jeitos diferentes num recorde só", async () => {
    await logExercicio("Supino reto", 80, 5);
    const news = await logExercicio("supino  reto", 90, 5);

    const prs = await PersonalRecord.find({ user: userId, type: "carga_max" });
    expect(prs).toHaveLength(1);
    expect(prs[0].exerciseSlug).toBe("supino_reto");
    expect(prs[0].value).toBe(90);
    expect(prs[0].previousValue).toBe(80);
    expect(news.some((p) => p.type === "carga_max")).toBe(true);
  });

  it("o rótulo acompanha a grafia mais recente, a identidade não muda", async () => {
    await logExercicio("supino reto", 80, 5);
    await logExercicio("Supino Reto", 90, 5);

    const pr = await PersonalRecord.findOne({ user: userId, type: "carga_max" });
    expect(pr?.exerciseName).toBe("Supino Reto");
    expect(pr?.exerciseSlug).toBe("supino_reto");
  });

  it("exercícios diferentes continuam com recordes separados", async () => {
    await logExercicio("Supino reto", 80, 5);
    await logExercicio("Agachamento livre", 100, 5);

    const prs = await PersonalRecord.find({ user: userId, type: "carga_max" });
    expect(prs).toHaveLength(2);
    expect(prs.map((p) => p.exerciseSlug).sort()).toEqual(["agachamento_livre", "supino_reto"]);
  });

  it("quem escolheu do catálogo e quem digitou o nome caem no mesmo recorde", async () => {
    // "Flexão de braço" tem id `flexao` no catálogo: sem o mapa de nomes, o
    // digitado viraria `flexao_de_braco` e seriam dois recordes.
    const activity = await Activity.create({
      user: userId,
      sportId: "musculacao",
      kind: "strength",
      startedAt: new Date(),
      payload: {
        variant: "musculacao",
        exercises: [
          { name: "Flexão", exerciseId: "flexao", sets: [{ type: "valida", weightKg: 10, reps: 5, done: true }] },
        ],
      },
      metrics: {},
    });
    await detectStrengthPRs(userId, activity);
    await logExercicio("Flexão de braço", 20, 5);

    const prs = await PersonalRecord.find({ user: userId, type: "carga_max" });
    expect(prs).toHaveLength(1);
    expect(prs[0].exerciseSlug).toBe("flexao");
    expect(prs[0].value).toBe(20);
  });
});
