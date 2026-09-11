import { describe, it, expect } from "vitest";
import { movimentosDoCartao } from "./movimentosDoCartao.js";

/** Um bloco cru, como ele chega do Mongo: sem `lido`, sem defaults do zod. */
const bloco = (modo: string, movimentos: unknown[], extra: object = {}) => ({
  modo,
  movimentos,
  ...extra,
});

const wod = (blocos: unknown[]) => ({ v: 3, blocos });

describe("movimentosDoCartao", () => {
  it("formata a escada com as duas cargas do quadro", () => {
    const linhas = movimentosDoCartao(
      "wod",
      wod([
        bloco(
          "21-15-9",
          [
            {
              nome: "Thruster",
              volume: { valor: [21, 15, 9], unidade: "reps" },
              carga: { rx: 43, rxF: 30, unidade: "kg" },
              escopo: "individual",
            },
            {
              nome: "Pull Up",
              volume: { valor: [21, 15, 9], unidade: "reps" },
              escopo: "individual",
            },
          ],
          { resultado: { tipo: "tempo", tempoSec: 332 } }
        ),
      ])
    );

    expect(linhas).toEqual(["21-15-9  Thruster  43/30 kg", "21-15-9  Pull Up"]);
  });

  it("usa a unidade do volume, e não um campo por medida", () => {
    const linhas = movimentosDoCartao(
      "wod",
      wod([
        bloco("FOR TIME", [
          { nome: "Run", volume: { valor: 400, unidade: "metros" }, escopo: "individual" },
          { nome: "Row", volume: { valor: 20, unidade: "cal" }, escopo: "individual" },
          { nome: "Plank", volume: { valor: 90, unidade: "seg" }, escopo: "individual" },
        ]),
      ])
    );

    expect(linhas).toEqual(["400 m  Run", "20 cal  Row", "1:30  Plank"]);
  });

  it("mostra o escopo quando ele muda a conta", () => {
    const linhas = movimentosDoCartao(
      "wod",
      wod([
        bloco("FOR TIME 7'", [
          { nome: "Run", volume: { valor: 400, unidade: "metros" }, escopo: "junto" },
          { nome: "Rope Climb", volume: { valor: 2, unidade: "reps" }, escopo: "cada" },
          { nome: "BJO", volume: { valor: 40, unidade: "reps" }, escopo: "dividido" },
        ]),
      ])
    );

    expect(linhas[0]).toBe("400 m  Run  (junto)");
    expect(linhas[1]).toBe("2  Rope Climb  (cada)");
    // "dividido" é o comportamento esperado de um Relay: não precisa dizer.
    expect(linhas[2]).toBe("40  BJO");
  });

  it("mostra os blocos COM resultado, e ignora o resto", () => {
    const linhas = movimentosDoCartao(
      "wod",
      wod([
        bloco("WARM-UP", [{ nome: "Beat Swing", volume: { valor: 4, unidade: "reps" } }]),
        bloco("REST 1'", []),
        bloco("AMRAP 6'", [{ nome: "Burpee", volume: { valor: 20, unidade: "reps" } }], {
          resultado: { tipo: "rounds_reps", rounds: 7 },
        }),
      ])
    );

    expect(linhas).toEqual(["20  Burpee"]);
  });

  it("sem resultado nenhum, deixa de fora descanso e aquecimento", () => {
    const linhas = movimentosDoCartao(
      "wod",
      wod([
        bloco("WARM-UP", [{ nome: "Beat Swing", volume: { valor: 4, unidade: "reps" } }], {
          lido: { familia: "livre", versao: 1 },
        }),
        bloco("REST 1'", [], { lido: { familia: "descanso", versao: 1 } }),
        bloco("AMRAP 6'", [{ nome: "Burpee", volume: { valor: 20, unidade: "reps" } }], {
          lido: { familia: "amrap", versao: 1 },
        }),
      ])
    );

    expect(linhas).toEqual(["20  Burpee"]);
  });

  it("bloco sem movimentos não derruba o cartão", () => {
    // O payload chega CRU do Mongo, sem os defaults do zod: `movimentos` pode
    // simplesmente não existir. Ja quebrou aqui com "Cannot read properties of
    // undefined".
    expect(() =>
      movimentosDoCartao("wod", { v: 3, blocos: [{ modo: "REST 1'" }] })
    ).not.toThrow();
  });

  it("séries aparecem quando o quadro prescreve", () => {
    const [linha] = movimentosDoCartao(
      "wod",
      wod([
        bloco("SKILL / STRENGTH", [
          {
            nome: "Back Squat",
            series: 5,
            volume: { valor: 5, unidade: "reps" },
            carga: { rx: 100, unidade: "kg" },
            escopo: "individual",
          },
        ]),
      ])
    );

    expect(linha).toBe("5×5  Back Squat  100 kg");
  });

  it("resume força em séries × reps, ignorando aquecimento", () => {
    const linhas = movimentosDoCartao("strength", {
      exercises: [
        {
          name: "Supino",
          sets: [
            { type: "aquecimento", weightKg: 20, reps: 15, done: true },
            { type: "valida", weightKg: 60, reps: 10, done: true },
            { type: "valida", weightKg: 62.5, reps: 8, done: true },
          ],
        },
      ],
    });

    expect(linhas).toEqual(["2×10  Supino  62,5 kg"]);
  });

  it("não inventa carga em peso corporal", () => {
    const [linha] = movimentosDoCartao(
      "wod",
      wod([
        bloco("AMRAP 10'", [
          {
            nome: "Push Up",
            volume: { valor: 30, unidade: "reps" },
            carga: { rx: 0, unidade: "corporal" },
            escopo: "individual",
          },
        ]),
      ])
    );

    expect(linha).toBe("30  Push Up");
  });

  it("corrida não lista movimento — o percurso é o conteúdo", () => {
    expect(movimentosDoCartao("endurance", { points: [{ lat: 1, lng: 2 }] })).toEqual([]);
    expect(movimentosDoCartao("wod", undefined)).toEqual([]);
  });

  it("corta em oito: o cartão não é a ficha do treino", () => {
    const muitos = Array.from({ length: 14 }, (_, i) => ({
      nome: `Mov ${i}`,
      volume: { valor: 10, unidade: "reps" },
      escopo: "individual",
    }));

    expect(movimentosDoCartao("wod", wod([bloco("FOR TIME", muitos)]))).toHaveLength(8);
  });
});
