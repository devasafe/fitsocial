import { describe, it, expect } from "vitest";
import { computeStrengthMetrics, computeMetrics } from "./activityMetrics.js";
import { activityCreateSchema } from "../models/Activity.js";

describe("computeStrengthMetrics", () => {
  it("soma volume só das séries válidas (ignora aquecimento)", () => {
    const metrics = computeStrengthMetrics({
      variant: "musculacao",
      exercises: [
        {
          name: "Supino",
          sets: [
            { type: "aquecimento", weightKg: 40, reps: 10, done: true },
            { type: "valida", weightKg: 60, reps: 10, done: true },
            { type: "valida", weightKg: 60, reps: 8, done: true },
          ],
        },
      ],
    });

    expect(metrics.volumeTotalKg).toBe(60 * 10 + 60 * 8); // aquecimento fora
    expect(metrics.seriesValidas).toBe(2);
  });

  it("trata reps ausentes como zero (ex.: isometria)", () => {
    const metrics = computeStrengthMetrics({
      variant: "calistenia",
      exercises: [{ name: "Prancha", sets: [{ type: "valida", weightKg: 0, holdSec: 60, done: true }] }],
    });
    expect(metrics.volumeTotalKg).toBe(0);
    expect(metrics.seriesValidas).toBe(1);
  });
});

describe("computeStrengthMetrics — grupos musculares", () => {
  it("agrupa as séries por músculo e ordena pelo que mais pesou no dia", () => {
    const m = computeStrengthMetrics({
      variant: "musculacao",
      exercises: [
        {
          name: "Panturrilha em pé",
          sets: [
            { type: "valida", weightKg: 80, reps: 15, done: true },
            { type: "valida", weightKg: 80, reps: 15, done: true },
          ],
        },
        {
          name: "Agachamento livre",
          sets: [
            { type: "valida", weightKg: 100, reps: 5, done: true },
            { type: "valida", weightKg: 100, reps: 5, done: true },
            { type: "valida", weightKg: 100, reps: 5, done: true },
          ],
        },
      ],
    });

    expect(m.seriesPorGrupo).toEqual({ "Quadríceps": 3, Panturrilha: 2 });
    expect(m.musculos).toEqual(["Quadríceps", "Panturrilha"]); // 3 séries > 2
  });

  it("aquecimento não conta para o grupo, como não conta para o volume", () => {
    const m = computeStrengthMetrics({
      variant: "musculacao",
      exercises: [
        {
          name: "Supino reto",
          sets: [
            { type: "aquecimento", weightKg: 40, reps: 10, done: true },
            { type: "valida", weightKg: 80, reps: 8, done: true },
          ],
        },
      ],
    });

    expect(m.seriesPorGrupo).toEqual({ Peito: 1 });
    expect(m.seriesValidas).toBe(1);
  });

  it("exercício que não resolve fica fora do grupo mas dentro do volume", () => {
    const m = computeStrengthMetrics({
      variant: "musculacao",
      exercises: [
        {
          name: "maquina nova da academia",
          sets: [{ type: "valida", weightKg: 50, reps: 10, done: true }],
        },
      ],
    });

    expect(m.volumeTotalKg).toBe(500); // a pessoa levantou; só não se sabe com o quê
    expect(m.seriesValidas).toBe(1);
    expect(m.musculos).toEqual([]);
    expect(m.seriesPorGrupo).toEqual({});
  });

  it("o músculo marcado pela pessoa ganha do nome", () => {
    const m = computeStrengthMetrics({
      variant: "musculacao",
      exercises: [
        {
          name: "maquina nova da academia",
          muscle: "Costas",
          sets: [{ type: "valida", weightKg: 50, reps: 10, done: true }],
        },
      ],
    });

    expect(m.musculos).toEqual(["Costas"]);
  });

  it("empate em séries E em volume é desempatado pelo nome", () => {
    // É a única garantia de que dois payloads idênticos geram o MESMO card.
    // Sem este critério, a ordem dependeria da ordem de inserção no objeto.
    const m = computeStrengthMetrics({
      variant: "musculacao",
      exercises: [
        { name: "Tríceps corda", sets: [{ type: "valida", weightKg: 30, reps: 10, done: true }] },
        { name: "Rosca direta", sets: [{ type: "valida", weightKg: 30, reps: 10, done: true }] },
      ],
    });

    expect(m.musculos).toEqual(["Bíceps", "Tríceps"]);
  });

  it("empate em séries é desempatado pelo volume", () => {
    const m = computeStrengthMetrics({
      variant: "musculacao",
      exercises: [
        { name: "Rosca direta", sets: [{ type: "valida", weightKg: 20, reps: 10, done: true }] },
        { name: "Supino reto", sets: [{ type: "valida", weightKg: 80, reps: 10, done: true }] },
      ],
    });

    expect(m.musculos).toEqual(["Peito", "Bíceps"]); // 800 kg > 200 kg
  });
});

describe("computeMetrics por formato (2b)", () => {
  it("endurance calcula distância, pace e velocidade", () => {
    const input = activityCreateSchema.parse({
      sportId: "corrida",
      kind: "endurance",
      durationSec: 1800,
      payload: { distanceM: 5000 },
    });
    const m = computeMetrics(input);
    expect(m.distanceKm).toBe(5);
    expect(m.avgPaceSecPerKm).toBe(360); // 6:00 / km
    expect(Math.round(m.speedKmh as number)).toBe(10);
  });

  it("class e generic guardam os minutos", () => {
    const cls = activityCreateSchema.parse({
      sportId: "jiu_jitsu",
      kind: "class",
      durationSec: 3600,
      payload: { modality: "jiu_jitsu" },
    });
    expect(computeMetrics(cls).minutes).toBe(60);

    const gen = activityCreateSchema.parse({
      sportId: "outro",
      kind: "generic",
      durationSec: 1200,
      payload: { activityName: "Surf" },
    });
    expect(computeMetrics(gen).minutes).toBe(20);
  });
});
