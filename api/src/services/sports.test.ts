import { describe, it, expect } from "vitest";
import { SPORTS, getSport, isValidSport, ACTIVITY_KINDS } from "./sports.js";

describe("catálogo de esportes", () => {
  it("tem os 21 esportes da Fase 2", () => {
    expect(SPORTS).toHaveLength(21);
  });

  it("todo esporte aponta para um dos 5 formatos (kind) válidos", () => {
    for (const s of SPORTS) {
      expect(ACTIVITY_KINDS).toContain(s.kind);
    }
  });

  it("os sportId são únicos", () => {
    const ids = SPORTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("mapeia cada esporte ao formato certo", () => {
    expect(getSport("musculacao")?.kind).toBe("strength");
    expect(getSport("corrida")?.kind).toBe("endurance");
    expect(getSport("crossfit")?.kind).toBe("wod");
    expect(getSport("jiu_jitsu")?.kind).toBe("class");
    expect(getSport("outro")?.kind).toBe("generic");
  });

  it("valida sportId conhecido e rejeita desconhecido", () => {
    expect(isValidSport("musculacao")).toBe(true);
    expect(isValidSport("quadribol")).toBe(false);
  });
});
