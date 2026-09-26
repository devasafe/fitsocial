import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { computeStats } from "./adherence.js";

/**
 * A sequência precisa contar os dias no fuso de São Paulo.
 *
 * O resto do projeto já conta assim (`utils/dia.ts`), e aqui era UTC. Enquanto
 * a sequência era só um número na tela isso passava despercebido; a partir do
 * momento em que ela tem CONSEQUÊNCIA — some, avisa, cobra — contar errado é
 * tirar da pessoa uma sequência que ela não perdeu, ou dar uma que ela não fez.
 *
 * São Paulo está três horas atrás de UTC, então todo treino entre 21h e
 * meia-noite cai no dia seguinte quando contado em UTC. É a faixa de quem
 * treina depois do trabalho.
 */
describe("computeStats — a sequência conta os dias em São Paulo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dois treinos no MESMO dia não viram dois dias de sequência", () => {
    // Quinta, 23h em São Paulo — já é sexta em UTC.
    vi.setSystemTime(new Date("2026-09-24T23:00:00-03:00"));

    const logs = [
      { date: new Date("2026-09-24T10:00:00-03:00") }, // manhã
      { date: new Date("2026-09-24T22:00:00-03:00") }, // à noite, MESMO dia daqui
    ];

    // Em UTC o treino das 22h cai no dia 25, e a conta devolveria 2.
    expect(computeStats(logs).streak).toBe(1);
  });

  it("treino de ontem à noite e de hoje cedo são dois dias", () => {
    vi.setSystemTime(new Date("2026-09-25T10:00:00-03:00"));

    const logs = [
      { date: new Date("2026-09-24T22:00:00-03:00") }, // ontem, 22h
      { date: new Date("2026-09-25T08:00:00-03:00") }, // hoje, 8h
    ];

    // Em UTC os dois caem no dia 25 — um dia só — e a sequência sumiria.
    expect(computeStats(logs).streak).toBe(2);
  });

  it("treinar às 22h mantém a sequência viva no dia seguinte", () => {
    vi.setSystemTime(new Date("2026-09-25T09:00:00-03:00"));

    // Três noites seguidas, todas no horário que o UTC empurra para frente.
    const logs = [
      { date: new Date("2026-09-22T22:00:00-03:00") },
      { date: new Date("2026-09-23T22:00:00-03:00") },
      { date: new Date("2026-09-24T22:00:00-03:00") },
    ];

    expect(computeStats(logs).streak).toBe(3);
  });
});

/**
 * Para a sequência cobrar algo, ela precisa de duas informações que não
 * existiam: qual foi a MELHOR marca (é o que dá o que reconquistar depois de
 * perder) e se a de hoje está EM RISCO (é o que justifica avisar).
 */
describe("computeStats — melhor marca e risco", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("lembra a melhor sequência já feita, mesmo depois de ela ser perdida", () => {
    vi.setSystemTime(new Date("2026-09-25T10:00:00-03:00"));

    const logs = [
      // Uma sequência de quatro dias, em agosto.
      { date: new Date("2026-08-10T10:00:00-03:00") },
      { date: new Date("2026-08-11T10:00:00-03:00") },
      { date: new Date("2026-08-12T10:00:00-03:00") },
      { date: new Date("2026-08-13T10:00:00-03:00") },
      // E a de agora, de um dia só.
      { date: new Date("2026-09-25T09:00:00-03:00") },
    ];

    const s = computeStats(logs);
    expect(s.streak).toBe(1);
    expect(s.melhorStreak).toBe(4);
  });

  it("a melhor marca nunca é menor que a sequência atual", () => {
    vi.setSystemTime(new Date("2026-09-25T10:00:00-03:00"));

    const logs = [
      { date: new Date("2026-09-23T10:00:00-03:00") },
      { date: new Date("2026-09-24T10:00:00-03:00") },
      { date: new Date("2026-09-25T10:00:00-03:00") },
    ];

    const s = computeStats(logs);
    expect(s.streak).toBe(3);
    expect(s.melhorStreak).toBe(3);
  });

  // "Em risco" é: existe sequência viva E hoje ainda não teve treino. Sem a
  // segunda parte, avisaríamos quem já treinou — o jeito mais rápido de a
  // pessoa desligar os avisos.
  it("está em risco quem tem sequência viva e ainda não treinou hoje", () => {
    vi.setSystemTime(new Date("2026-09-25T20:00:00-03:00"));

    const logs = [
      { date: new Date("2026-09-23T10:00:00-03:00") },
      { date: new Date("2026-09-24T10:00:00-03:00") },
    ];

    const s = computeStats(logs);
    expect(s.streak).toBe(2);
    expect(s.emRisco).toBe(true);
  });

  it("não está em risco quem já treinou hoje", () => {
    vi.setSystemTime(new Date("2026-09-25T20:00:00-03:00"));

    const logs = [
      { date: new Date("2026-09-24T10:00:00-03:00") },
      { date: new Date("2026-09-25T07:00:00-03:00") },
    ];

    expect(computeStats(logs).emRisco).toBe(false);
  });

  it("não está em risco quem não tem sequência nenhuma para perder", () => {
    vi.setSystemTime(new Date("2026-09-25T20:00:00-03:00"));

    const logs = [{ date: new Date("2026-09-01T10:00:00-03:00") }];

    const s = computeStats(logs);
    expect(s.streak).toBe(0);
    expect(s.emRisco).toBe(false);
  });
});
