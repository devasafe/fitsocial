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
    expect(parsed.kind).toBe("strength");
    if (parsed.kind !== "strength") return;
    expect(parsed.payload.variant).toBe("musculacao");
    expect(parsed.payload.exercises[0].sets[0].type).toBe("valida");
    expect(parsed.payload.exercises[0].sets[0].done).toBe(true);
  });

  it("rejeita sportId desconhecido", () => {
    expect(() => activityCreateSchema.parse({ ...strengthBase, sportId: "quadribol" })).toThrow();
  });

  it("exige ao menos um exercício", () => {
    expect(() =>
      activityCreateSchema.parse({ ...strengthBase, payload: { exercises: [] } })
    ).toThrow();
  });

  it("rejeita kind desconhecido", () => {
    expect(() => activityCreateSchema.parse({ ...strengthBase, kind: "xadrez" })).toThrow();
  });
});

describe("activityCreateSchema — formatos da Fase 2b", () => {
  it("aceita endurance (corrida manual)", () => {
    const parsed = activityCreateSchema.parse({
      sportId: "corrida",
      kind: "endurance",
      durationSec: 1800,
      payload: { subType: "rua", distanceM: 5000 },
    });
    expect(parsed.kind).toBe("endurance");
    if (parsed.kind === "endurance") expect(parsed.payload.distanceM).toBe(5000);
  });

  it("aceita class (luta/aula) e exige modality", () => {
    const parsed = activityCreateSchema.parse({
      sportId: "jiu_jitsu",
      kind: "class",
      durationSec: 3600,
      payload: { modality: "jiu_jitsu", sessionType: "sparring", gi: true, rounds: 6 },
    });
    expect(parsed.kind).toBe("class");
    expect(() =>
      activityCreateSchema.parse({ sportId: "jiu_jitsu", kind: "class", payload: {} })
    ).toThrow();
  });

  it("aceita generic e exige activityName; limita a 3 métricas custom", () => {
    const parsed = activityCreateSchema.parse({
      sportId: "outro",
      kind: "generic",
      payload: { activityName: "Surf", customMetrics: [{ label: "ondas", value: "12" }] },
    });
    expect(parsed.kind).toBe("generic");
    expect(() =>
      activityCreateSchema.parse({
        sportId: "outro",
        kind: "generic",
        payload: {
          activityName: "x",
          customMetrics: [
            { label: "a", value: "1" },
            { label: "b", value: "2" },
            { label: "c", value: "3" },
            { label: "d", value: "4" },
          ],
        },
      })
    ).toThrow();
  });
});
