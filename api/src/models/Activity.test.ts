import { describe, it, expect } from "vitest";
import { activityCreateSchema } from "./Activity.js";

const strengthBase = {
  sportId: "musculacao",
  kind: "strength",
  payload: {
    exercises: [{ name: "Supino", sets: [{ weightKg: 60, reps: 10 }] }],
  },
};

describe("activityCreateSchema", () => {
  it("valida um registro de strength e aplica os defaults", () => {
    const parsed = activityCreateSchema.parse(strengthBase);
    expect(parsed.visibility).toBe("followers");
    expect(parsed.payload.variant).toBe("musculacao");
    expect(parsed.payload.exercises[0].sets[0].type).toBe("valida");
    expect(parsed.payload.exercises[0].sets[0].done).toBe(true);
  });

  it("rejeita sportId desconhecido", () => {
    expect(() => activityCreateSchema.parse({ ...strengthBase, sportId: "quadribol" })).toThrow();
  });

  it("na Fase 2a só aceita kind 'strength'", () => {
    expect(() => activityCreateSchema.parse({ ...strengthBase, kind: "endurance" })).toThrow();
  });

  it("exige ao menos um exercício", () => {
    expect(() =>
      activityCreateSchema.parse({ ...strengthBase, payload: { exercises: [] } })
    ).toThrow();
  });
});
