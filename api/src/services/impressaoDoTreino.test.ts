import { describe, it, expect } from "vitest";
import { impressaoDoTreino } from "./impressaoDoTreino.js";

describe("impressão digital do treino", () => {
  it("não muda com a ordem das chaves", () => {
    const a = impressaoDoTreino({ kind: "strength", sportId: "musculacao", durationSec: 3600,
      payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] } });
    const b = impressaoDoTreino({ kind: "strength", sportId: "musculacao", durationSec: 3600,
      payload: { exercises: [{ sets: [{ reps: 8, weightKg: 80 }], name: "Supino" }] } });
    expect(a).toBe(b);
  });

  it("muda quando um número do treino muda", () => {
    const base = { kind: "strength" as const, sportId: "musculacao", durationSec: 3600,
      payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 80, reps: 8 }] }] } };
    const outro = { ...base,
      payload: { exercises: [{ name: "Supino", sets: [{ weightKg: 82.5, reps: 8 }] }] } };
    expect(impressaoDoTreino(base)).not.toBe(impressaoDoTreino(outro));
  });

  it("muda quando o esporte muda, mesmo com o conteúdo igual", () => {
    const p = { kind: "class" as const, durationSec: 3600, payload: { modality: "boxe" } };
    expect(impressaoDoTreino({ ...p, sportId: "boxe" }))
      .not.toBe(impressaoDoTreino({ ...p, sportId: "muay_thai" }));
  });

  it("campo ausente e campo null produzem a mesma impressão", () => {
    // O brief pede isso explicitamente (passo 3), mas nenhum dos três testes
    // dados verifica: campos derivados que às vezes chegam como `null` e
    // às vezes simplesmente não são enviados (ex.: cliente Android 1.2.0
    // que não manda um campo opcional) não podem gerar treinos "diferentes".
    const semCampo = impressaoDoTreino({
      kind: "endurance",
      sportId: "corrida",
      durationSec: 1800,
      payload: { distanceM: 5000 },
    });
    const comCampoNull = impressaoDoTreino({
      kind: "endurance",
      sportId: "corrida",
      durationSec: 1800,
      payload: { distanceM: 5000, elevationGainM: null },
    });
    const comCampoUndefined = impressaoDoTreino({
      kind: "endurance",
      sportId: "corrida",
      durationSec: 1800,
      payload: { distanceM: 5000, elevationGainM: undefined },
    });
    expect(semCampo).toBe(comCampoNull);
    expect(semCampo).toBe(comCampoUndefined);
  });
});
