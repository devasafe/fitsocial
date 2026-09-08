import { describe, it, expect } from "vitest";
import { searchExercises, EXERCISES } from "./exercisesCatalog.js";
import { searchWods, WOD_BENCHMARKS } from "./wodBenchmarks.js";

describe("searchExercises", () => {
  it("acha por nome ignorando acento e caixa", () => {
    const res = searchExercises("agach");
    expect(res.some((e) => e.name.toLowerCase().includes("agachamento"))).toBe(true);
  });

  it("sem query devolve uma amostra (não vazia)", () => {
    expect(searchExercises("").length).toBeGreaterThan(0);
  });

  it("todo exercício tem grupo muscular e equipamento", () => {
    for (const e of EXERCISES) {
      expect(e.muscle.length).toBeGreaterThan(0);
      expect(e.equipment.length).toBeGreaterThan(0);
    }
  });
});

describe("searchWods", () => {
  it("acha Fran e traz a prescrição e o tipo de score", () => {
    const res = searchWods("fran");
    const fran = res.find((w) => w.name.toLowerCase() === "fran");
    expect(fran).toBeTruthy();
    expect(fran?.scoreType).toBe("for_time");
    expect(fran?.prescription.length).toBeGreaterThan(0);
  });

  it("tem ao menos 10 benchmarks", () => {
    expect(WOD_BENCHMARKS.length).toBeGreaterThanOrEqual(10);
  });
});
