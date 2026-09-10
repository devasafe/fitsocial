import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { wodPayloadV2Schema } from "../models/crossfit.js";
import { normalizarWod, movimentosDoTreino, paraFormatoAntigo } from "./crossfit.js";
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
 * revezamento, "cada" e aquecimento com intervalo ao mesmo tempo. */

const QUADRO = {
  v: 2 as const,
  box: "CrossFit do bairro",
  blocos: [
    {
      tipo: "aquecimento" as const,
      formato: "emom" as const,
      intervaloSec: 75,
      rounds: 4,
      movimentos: [
        { nome: "Beat Swing", reps: 4 },
        { nome: "Pull Up", reps: 2 },
        { nome: "Skipping", reps: 20 },
        { nome: "Broad Jump", reps: 4 },
      ],
    },
    { tipo: "skill" as const, movimento: "Rope Climb", formato: "pratica_livre" as const },
    {
      tipo: "metcon" as const,
      nome: "Relay",
      grupo: "WOD",
      formato: "amrap" as const,
      equipe: { tamanho: 2, modo: "revezamento" as const, parceiros: ["Bruno"] },
      prescricao: {
        duracaoSec: 360,
        movimentos: [
          { nome: "Run", distanciaM: 100 },
          { nome: "Rope Climb", reps: 2 },
        ],
      },
      resultado: { tipo: "rounds_reps" as const, rounds: 7, repsExtras: 1 },
      escala: { nivel: "rx" as const },
    },
    { tipo: "descanso" as const, duracaoSec: 60 },
    {
      tipo: "metcon" as const,
      nome: "Relay",
      grupo: "WOD",
      formato: "amrap" as const,
      equipe: { tamanho: 2, modo: "revezamento" as const },
      prescricao: {
        duracaoSec: 360,
        movimentos: [
          { nome: "BJO", reps: 20 },
          { nome: "C2B", reps: 10 },
        ],
      },
      resultado: { tipo: "rounds_reps" as const, rounds: 4, repsExtras: 12 },
      escala: { nivel: "rx" as const },
    },
    { tipo: "descanso" as const, duracaoSec: 60 },
    {
      tipo: "metcon" as const,
      nome: "Final",
      grupo: "WOD",
      formato: "for_time" as const,
      equipe: { tamanho: 2, modo: "junto" as const },
      prescricao: {
        timeCapSec: 420,
        movimentos: [
          { nome: "Run", distanciaM: 400 },
          { nome: "Rope Climb", reps: 2, porPessoa: true },
          { nome: "BJO", reps: 40 },
          { nome: "C2B", reps: 20 },
        ],
      },
      resultado: { tipo: "tempo" as const, tempoSec: 384 },
      escala: { nivel: "rx" as const },
    },
  ],
};

describe("O quadro do box inteiro cabe no modelo", () => {
  it("é aceito como está", () => {
    const r = wodPayloadV2Schema.safeParse(QUADRO);
    expect(r.success, JSON.stringify(r.success ? {} : r.error.issues.slice(0, 3))).toBe(true);
  });

  it("o aquecimento guarda que era EMOM de 1'15\" por 4 rounds", () => {
    const wod = normalizarWod(QUADRO);
    const aq = wod.blocos[0];
    expect(aq.tipo).toBe("aquecimento");
    // Antes disto, "EMOM 1:15" só cabia como texto solto na nota — e aí a
    // pessoa registrava o aquecimento como se fosse WOD, para ter o intervalo.
    expect(aq).toMatchObject({ formato: "emom", intervaloSec: 75, rounds: 4 });
  });

  it("o descanso entre as partes é um bloco, não uma nota", () => {
    const wod = normalizarWod(QUADRO);
    const descansos = wod.blocos.filter((b) => b.tipo === "descanso");
    expect(descansos).toHaveLength(2);
    expect(descansos[0]).toMatchObject({ duracaoSec: 60 });
  });

  it("as três partes do WOD ficam agrupadas, e cada uma guarda o próprio resultado", () => {
    const wod = normalizarWod(QUADRO);
    const partes = wod.blocos.filter((b) => b.tipo === "metcon" && b.grupo === "WOD");
    expect(partes).toHaveLength(3);
    // Três resultados: foram três esforços, não um.
    expect(partes.every((p) => p.tipo === "metcon" && p.resultado)).toBe(true);
  });

  it('"2 Rope Climb (cada)" fica distinguível de dividir a conta', () => {
    const wod = normalizarWod(QUADRO);
    const final = wod.blocos.find((b) => b.tipo === "metcon" && b.nome === "Final");
    const rope = final?.tipo === "metcon" ? final.prescricao.movimentos[1] : null;
    expect(rope).toMatchObject({ nome: "Rope Climb", porPessoa: true });
  });

  it("junta os movimentos de todos os blocos, sem quebrar no descanso", () => {
    // O descanso não tem `movimentos`, e a função assumia que todo bloco tinha.
    const nomes = movimentosDoTreino(normalizarWod(QUADRO));
    expect(nomes).toContain("beat_swing");
    expect(nomes).toContain("rope_climb");
    expect(nomes).toContain("c2b");
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
  const soOFinal = (comEquipe: boolean) => ({
    v: 2 as const,
    blocos: [
      {
        ...QUADRO.blocos[6],
        ...(comEquipe ? {} : { equipe: undefined }),
      },
    ],
  });

  it("dupla NAO entra no recorde individual", async () => {
    // Linha de base individual, para haver contra o que comparar.
    await registrar(soOFinal(false));

    // Um tempo MUITO melhor, mas em dupla. Vinte Chest-to-Bar revezados entre
    // dois nao e vinte sozinho: deixar competir derrubaria o recorde de quem
    // fez o treino inteiro sozinho.
    const emDupla = {
      v: 2 as const,
      blocos: [
        {
          ...QUADRO.blocos[6],
          resultado: { tipo: "tempo" as const, tempoSec: 200 },
        },
      ],
    };
    const novos = await registrar(emDupla);

    expect(novos.filter((p) => p.type === "wod_time")).toEqual([]);

    const gravado = await PersonalRecord.findOne({ user: userId, type: "wod_time" }).lean();
    expect(gravado?.value).toBe(384); // o individual, nao o 200 da dupla
  });

  it("o mesmo treino sem equipe gera recorde normalmente", async () => {
    const novos = await registrar(soOFinal(false));
    expect(novos.length).toBeGreaterThanOrEqual(0);

    const gravado = await PersonalRecord.findOne({ user: userId, type: "wod_time" }).lean();
    expect(gravado?.value).toBe(384);
  });
});

describe("O APK antigo continua lendo este treino", () => {
  it("os campos planos saem preenchidos, apesar dos blocos novos", () => {
    const antigo = paraFormatoAntigo(normalizarWod(QUADRO));

    // Sem isto, quem não atualizou vê "WOD: —" para tudo.
    expect(antigo.name).toBeTruthy();
    expect(antigo.level).toBe("rx");
    expect(Array.isArray(antigo.movements)).toBe(true);
  });
});
