import { describe, it, expect } from "vitest";
import { movimentosDoCartao } from "./movimentosDoCartao.js";

describe("movimentosDoCartao", () => {
  it("formata o metcon v2 com repScheme e carga", () => {
    const linhas = movimentosDoCartao("wod", {
      blocos: [
        {
          tipo: "metcon",
          formato: "for_time",
          escala: { nivel: "rx" },
          prescricao: {
            movimentos: [
              { nome: "Thruster", repScheme: [21, 15, 9], carga: { valor: 43, unidade: "kg" } },
              { nome: "Pull Up", repScheme: [21, 15, 9] },
            ],
          },
        },
      ],
    });

    expect(linhas).toEqual(["21-15-9  Thruster  43 kg", "21-15-9  Pull Up"]);
  });

  it("usa distância, calorias e duração quando não há reps", () => {
    const linhas = movimentosDoCartao("wod", {
      blocos: [
        {
          tipo: "metcon",
          prescricao: {
            movimentos: [
              { nome: "Run", distanciaM: 400 },
              { nome: "Row", calorias: 20 },
              { nome: "Plank", duracaoSec: 90 },
            ],
          },
        },
      ],
    });

    expect(linhas).toEqual(["400 m  Run", "20 cal  Row", "1:30  Plank"]);
  });

  it("marca o que cada um faz inteiro em treino de dupla", () => {
    const [linha] = movimentosDoCartao("wod", {
      blocos: [
        {
          tipo: "metcon",
          equipe: { tamanho: 2, modo: "revezamento" },
          prescricao: { movimentos: [{ nome: "Rope Climb", reps: 2, porPessoa: true }] },
        },
      ],
    });

    expect(linha).toBe("2  Rope Climb  (cada)");
  });

  it("deixa de fora aquecimento, técnica e descanso", () => {
    const linhas = movimentosDoCartao("wod", {
      blocos: [
        { tipo: "aquecimento", movimentos: [{ nome: "Beat Swing", reps: 4 }] },
        { tipo: "skill", movimento: "Rope Climb" },
        { tipo: "descanso", duracaoSec: 60 },
        { tipo: "metcon", prescricao: { movimentos: [{ nome: "Burpee", reps: 20 }] } },
      ],
    });

    expect(linhas).toEqual(["20  Burpee"]);
  });

  it("junta os movimentos de todos os metcons, na ordem", () => {
    const linhas = movimentosDoCartao("wod", {
      blocos: [
        { tipo: "metcon", prescricao: { movimentos: [{ nome: "Run", distanciaM: 100 }] } },
        { tipo: "descanso", duracaoSec: 60 },
        { tipo: "metcon", prescricao: { movimentos: [{ nome: "C2B", reps: 10 }] } },
      ],
    });

    expect(linhas).toEqual(["100 m  Run", "10  C2B"]);
  });

  it("lê o WOD plano que o APK antigo ainda grava", () => {
    const linhas = movimentosDoCartao("wod", {
      movements: [
        { name: "Thruster", reps: 45, loadKg: 43 },
        { name: "Pull Up", reps: 45 },
      ],
    });

    expect(linhas).toEqual(["45  Thruster  43 kg", "45  Pull Up"]);
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

    expect(linhas).toEqual(["2×10  Supino  63 kg"]);
  });

  it("não inventa carga em peso corporal", () => {
    const [linha] = movimentosDoCartao("wod", {
      blocos: [
        {
          tipo: "metcon",
          prescricao: {
            movimentos: [{ nome: "Push Up", reps: 30, carga: { valor: 0, unidade: "corporal" } }],
          },
        },
      ],
    });

    expect(linha).toBe("30  Push Up");
  });

  it("corrida não lista movimento — o percurso é o conteúdo", () => {
    expect(movimentosDoCartao("endurance", { points: [{ lat: 1, lng: 2 }] })).toEqual([]);
    expect(movimentosDoCartao("wod", undefined)).toEqual([]);
  });

  it("corta em oito: o cartão não é a ficha do treino", () => {
    const muitos = Array.from({ length: 14 }, (_, i) => ({ nome: `Mov ${i}`, reps: 10 }));
    const linhas = movimentosDoCartao("wod", {
      blocos: [{ tipo: "metcon", prescricao: { movimentos: muitos } }],
    });

    expect(linhas).toHaveLength(8);
  });
});
