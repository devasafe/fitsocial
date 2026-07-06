import { describe, it, expect } from "vitest";
import { classifyExerciseKind, backfillWorkoutKinds } from "./exerciseKind.js";

describe("classifyExerciseKind", () => {
  it("detecta cardio por palavra-chave no nome", () => {
    expect(classifyExerciseKind("Esteira")).toBe("cardio");
    expect(classifyExerciseKind("Corrida na rua")).toBe("cardio");
    expect(classifyExerciseKind("Bicicleta ergométrica")).toBe("cardio");
    expect(classifyExerciseKind("Elíptico")).toBe("cardio");
    expect(classifyExerciseKind("Pular corda")).toBe("cardio");
  });

  it("detecta cardio pelo formato do reps (tempo/distância)", () => {
    expect(classifyExerciseKind("Aquecimento", "20 min")).toBe("cardio");
    expect(classifyExerciseKind("Tiro", "5 km")).toBe("cardio");
    expect(classifyExerciseKind("Intervalado", "30s")).toBe("cardio");
  });

  it("classifica musculação por padrão", () => {
    expect(classifyExerciseKind("Supino reto com barra", "8-12")).toBe("strength");
    expect(classifyExerciseKind("Agachamento livre", "5")).toBe("strength");
    expect(classifyExerciseKind("Rosca direta")).toBe("strength");
  });
});

describe("backfillWorkoutKinds", () => {
  it("preenche kind ausente e preserva o que já existe", () => {
    const workout = {
      sessions: [
        {
          exercises: [
            { name: "Esteira", reps: "20 min" }, // ausente → cardio
            { name: "Supino", reps: "8-12" }, // ausente → strength
            { name: "Agachamento", reps: "5", kind: "cardio" as const }, // presente → NÃO sobrescreve
          ],
        },
      ],
    };
    const out = backfillWorkoutKinds(workout);
    expect(out.sessions[0].exercises[0].kind).toBe("cardio");
    expect(out.sessions[0].exercises[1].kind).toBe("strength");
    expect(out.sessions[0].exercises[2].kind).toBe("cardio"); // preservado
  });
});
