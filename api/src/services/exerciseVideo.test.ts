import { describe, it, expect } from "vitest";
import { normalizeExerciseName } from "./exerciseVideo.js";

describe("normalizeExerciseName", () => {
  it("remove acentos e coloca em minúsculas", () => {
    expect(normalizeExerciseName("Supino Inclinado com Halteres")).toBe(
      "supino inclinado com halteres"
    );
    expect(normalizeExerciseName("Rosca Direta")).toBe("rosca direta");
    expect(normalizeExerciseName("Elevação Pélvica")).toBe("elevacao pelvica");
  });

  it("colapsa espaços e apara as bordas", () => {
    expect(normalizeExerciseName("  Puxada   Frontal  ")).toBe("puxada frontal");
  });

  it("preserva qualificadores que mudam o exercício", () => {
    expect(normalizeExerciseName("Supino Reto com Barra")).toBe("supino reto com barra");
    expect(normalizeExerciseName("Supino Reto na Máquina")).toBe("supino reto na maquina");
  });
});
