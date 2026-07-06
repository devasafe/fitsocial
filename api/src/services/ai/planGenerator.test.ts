import { describe, it, expect } from "vitest";
import { normalizePlanData } from "./planGenerator.js";

describe("normalizePlanData", () => {
  it("preenche kind ausente sem sobrescrever o que a IA mandou", () => {
    const plan = {
      summary: "s",
      workout: {
        split: "ABC",
        daysPerWeek: 3,
        sessions: [
          {
            day: "A",
            focus: "Geral",
            exercises: [
              { name: "Esteira", sets: 1, reps: "20 min", restSeconds: 0, notes: "" },
              { name: "Supino", sets: 4, reps: "8-12", restSeconds: 60, notes: "" },
              { name: "Agachamento", sets: 5, reps: "5", restSeconds: 120, notes: "", kind: "cardio" as const },
            ],
          },
        ],
      },
      diet: { dailyCalories: 2000, macros: { proteinG: 150, carbsG: 200, fatG: 60 }, meals: [{ name: "Café", timeHint: "", items: [{ food: "Ovos", quantity: "3" }] }], notes: "" },
      disclaimer: "d",
    };
    const out = normalizePlanData(plan);
    const ex = out.workout.sessions[0].exercises;
    expect(ex[0].kind).toBe("cardio"); // preenchido
    expect(ex[1].kind).toBe("strength"); // preenchido
    expect(ex[2].kind).toBe("cardio"); // preservado
  });
});
