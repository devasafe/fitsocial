import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { wodPayloadSchema } from "../models/crossfit.js";
import { normalizarWod, movimentosDoTreino, interpretarBlocos, volumeTotal } from "./crossfit.js";
import { detectPRs } from "./prEngine.js";
import { Activity } from "../models/Activity.js";
import { PersonalRecord } from "../models/PersonalRecord.js";

/* Um quadro de box de verdade, do dia 10/09/2026:
 *
 *   WARM-UP   EMOM (1'15") × 4 — 4 Beat Swing, 2 Pull Up, 20 Skipping, 4 Broad Jump
 *   SKILL     Rope Climb
 *   WOD       AMRAP + FOR TIME
 *             Bloco A) AMRAP 6' "Relay" — 100m Run, 2 Rope Climb
 *             REST 1'
 *             Bloco B) AMRAP 6' "Relay" — 20 BJO, 10 C2B
 *             REST 1'
 *             FOR TIME 7' — 400m Run together, 2 Rope Climb (cada), 40 BJO, 20 C2B
 *
 * Ele é o teste porque nenhum treino inventado tem descanso entre partes,
 * revezamento, "cada" e aquecimento com intervalo ao mesmo tempo.
 *
 * E é o caso nº 10 do briefing — a última linha é a que o v2 NÃO conseguia
 * representar: "400m Run together" e "2 Rope Climb cada" no MESMO bloco, com
 * escopos diferentes. Lá o escopo era do bloco inteiro. */

const m = (
  nome: string,
  volume?: { valor: number | number[]; unidade: "reps" | "seg" | "metros" | "cal" },
  escopo: "individual" | "dividido" | "cada" | "junto" = "individual"
) => ({ nome, volume, escopo });

const QUADRO = {
  v: 3 as const,
  box: "CrossFit do bairro",
  tamanhoDoTime: 2,
  parceiros: ["Bruno"],
  blocos: [
    {
      modo: 'EMOM (1\'15") x 4',
      nome: "WARM-UP",
      movimentos: [
        m("Beat Swing", { valor: 4, unidade: "reps" }),
        m("Pull Up", { valor: 2, unidade: "reps" }),
        m("Skipping", { valor: 20, unidade: "reps" }),
        m("Broad Jump", { valor: 4, unidade: "reps" }),
      ],
    },
    { modo: "SKILL", movimentos: [m("Rope Climb")] },
    {
      modo: "AMRAP 6'",
      nome: "BLOCO A",
      movimentos: [
        m("Run", { valor: 100, unidade: "metros" }, "dividido"),
        m("Rope Climb", { valor: 2, unidade: "reps" }, "dividido"),
      ],
      resultado: { tipo: "rounds_reps" as const, rounds: 7, repsExtras: 1 },
    },
    { modo: "REST 1'", movimentos: [] },
    {
      modo: "AMRAP 6'",
      nome: "BLOCO B",
      movimentos: [
        m("BJO", { valor: 20, unidade: "reps" }, "dividido"),
        m("C2B", { valor: 10, unidade: "reps" }, "dividido"),
      ],
      resultado: { tipo: "rounds_reps" as const, rounds: 4, repsExtras: 12 },
    },
    { modo: "REST 1'", movimentos: [] },
    {
      modo: "FOR TIME 7'",
      nome: "Final",
      movimentos: [
        // Escopos DIFERENTES no mesmo bloco — é isto que o v2 não conseguia.
        m("Run", { valor: 400, unidade: "metros" }, "junto"),
        m("Rope Climb", { valor: 2, unidade: "reps" }, "cada"),
        m("BJO", { valor: 40, unidade: "reps" }, "dividido"),
        m("C2B", { valor: 20, unidade: "reps" }, "dividido"),
      ],
      resultado: { tipo: "tempo" as const, tempoSec: 384 },
    },
  ],
};

describe("O quadro do box inteiro cabe no modelo", () => {
  it("é aceito como está", () => {
    expect(wodPayloadSchema.safeParse(QUADRO).success).toBe(true);
  });

  it("o modo guarda o que estava escrito, letra por letra", () => {
    // É a fonte da verdade: sem ele, reinterpretar depois é impossível.
    const wod = normalizarWod(QUADRO);
    expect(wod.blocos[0].modo).toBe('EMOM (1\'15") x 4');
    expect(wod.blocos[6].modo).toBe("FOR TIME 7'");
  });

  it("o interpretador tira a estrutura do aquecimento sem ninguém digitar", () => {
    const wod = interpretarBlocos(normalizarWod(QUADRO));
    const warmup = wod.blocos[0].lido!;

    expect(warmup.familia).toBe("emom");
    expect(warmup.intervaloSec).toBe(75);
    expect(warmup.rounds).toBe(4);
  });

  it("o descanso entre as partes é um bloco, não uma nota", () => {
    const wod = interpretarBlocos(normalizarWod(QUADRO));
    const descansos = wod.blocos.filter((b) => b.lido?.familia === "descanso");

    expect(descansos).toHaveLength(2);
    expect(descansos[0].lido?.duracaoSec).toBe(60);
  });

  it("as três partes do WOD guardam cada uma o próprio resultado", () => {
    const wod = normalizarWod(QUADRO);
    const comResultado = wod.blocos.filter((b) => b.resultado);

    expect(comResultado).toHaveLength(3);
    expect(comResultado[0].resultado?.rounds).toBe(7);
    expect(comResultado[2].resultado?.tempoSec).toBe(384);
  });

  it("o caso 10 do briefing: escopos diferentes no MESMO bloco", () => {
    const wod = normalizarWod(QUADRO);
    const final = wod.blocos[6];

    // 400m juntos: a dupla correu 400, não 800.
    expect(volumeTotal(final.movimentos[0], 2)).toBe(400);
    // 2 Rope Climb cada: a dupla fez 4.
    expect(volumeTotal(final.movimentos[1], 2)).toBe(4);
    // 40 BJO repartidos: 40 no total.
    expect(volumeTotal(final.movimentos[2], 2)).toBe(40);
  });

  it("junta os movimentos de todos os blocos, sem quebrar no descanso", () => {
    // O descanso não tem movimento, e por muito tempo isso foi o que quebrou
    // quem varria a lista assumindo que todo bloco tinha.
    const movs = movimentosDoTreino(normalizarWod(QUADRO));

    expect(movs).toContain("rope_climb");
    expect(movs).toContain("bjo");
    // "Rope Climb" aparece em três blocos — é um movimento só.
    expect(movs.filter((x) => x === "rope_climb")).toHaveLength(1);
  });
});

describe("Recorde em treino de equipe", () => {
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
    await Promise.all([Activity.deleteMany({}), PersonalRecord.deleteMany({})]);
  });

  async function registrar(payload: unknown) {
    const activity = await Activity.create({
      user: userId,
      sportId: "crossfit",
      kind: "wod",
      startedAt: new Date(),
      payload,
      metrics: {},
    });
    return detectPRs(userId, activity);
  }

  /** Só a parte final do quadro, que é a que tem resultado de tempo. */
  const soOFinal = (tamanhoDoTime: number, tempoSec = 384) => ({
    v: 3 as const,
    tamanhoDoTime,
    blocos: [
      {
        ...QUADRO.blocos[6],
        nome: "Final",
        resultado: { tipo: "tempo" as const, tempoSec },
      },
    ],
  });

  it("dupla NAO entra no recorde individual", async () => {
    // Linha de base individual, para haver contra o que comparar.
    await registrar(soOFinal(1));

    // Um tempo MUITO melhor, mas em dupla. Vinte Chest-to-Bar revezados entre
    // dois nao e vinte sozinho: deixar competir derrubaria o recorde de quem
    // fez o treino inteiro sozinho.
    const novos = await registrar(soOFinal(2, 200));

    expect(novos.filter((p) => p.type === "wod_time")).toEqual([]);

    const gravado = await PersonalRecord.findOne({ user: userId, type: "wod_time" }).lean();
    expect(gravado?.value).toBe(384); // o individual, nao o 200 da dupla
  });

  it("o mesmo treino sozinho gera recorde normalmente", async () => {
    await registrar(soOFinal(1));

    const gravado = await PersonalRecord.findOne({ user: userId, type: "wod_time" }).lean();
    expect(gravado?.value).toBe(384);
  });

  it("bloco sem resultado não vira recorde — nem o aquecimento", async () => {
    // A regra nova não pergunta "isso é metcon?", pergunta "isso tem
    // resultado?". Aquecimento não tem, então não concorre sozinho.
    const novos = await registrar({
      v: 3 as const,
      tamanhoDoTime: 1,
      blocos: [QUADRO.blocos[0], QUADRO.blocos[1]],
    });

    expect(novos).toEqual([]);
  });
});
