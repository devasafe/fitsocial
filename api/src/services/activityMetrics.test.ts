import { describe, it, expect } from "vitest";
import { computeStrengthMetrics } from "./activityMetrics.js";

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
