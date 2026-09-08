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
    expect(Math.round(m.speedKmh)).toBe(10);
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
