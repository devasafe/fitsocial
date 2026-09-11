import { describe, it, expect } from "vitest";
import { interpretarModo, tempoEmSegundos } from "./interpretarModo.js";

describe("tempoEmSegundos", () => {
  it("lê o tempo como o quadro escreve", () => {
    expect(tempoEmSegundos("6'")).toBe(360);
    expect(tempoEmSegundos("1'15\"")).toBe(75);
    expect(tempoEmSegundos("90\"")).toBe(90);
    expect(tempoEmSegundos("20:00")).toBe(1200);
    expect(tempoEmSegundos("7 min")).toBe(420);
    expect(tempoEmSegundos("45 seg")).toBe(45);
  });

  it("o composto vence o simples", () => {
    // Sem isto o 1' casa sozinho e o "15 vira outro tempo — o EMOM de 1'15"
    // viraria um EMOM de 60s, que e outro treino.
    expect(tempoEmSegundos("EMOM (1'15\") X 4")).toBe(75);
  });

  it("sem tempo devolve null, e nao zero", () => {
    // Zero seria confundido com "zero segundos prescritos".
    expect(tempoEmSegundos("FOR TIME")).toBeNull();
    expect(tempoEmSegundos("Fran")).toBeNull();
  });
});

// Os dez criterios de aceite do briefing, um a um.
// docs/superpowers/specs/2026-09-11-cadastro-de-treino-briefing.md
describe("os criterios de aceite do briefing", () => {
  it("1. 21-15-9 — escada sem verbo e for time", () => {
    const l = interpretarModo("21-15-9");
    expect(l.familia).toBe("for_time");
    expect(l.scoreSugerido).toBe("tempo");
  });

  it("2. AMRAP 20' — Cindy", () => {
    const l = interpretarModo("AMRAP 20'");
    expect(l.familia).toBe("amrap");
    expect(l.duracaoSec).toBe(1200);
    expect(l.scoreSugerido).toBe("rounds_reps");
  });

  it("3. 3 ROUNDS FOR TIME", () => {
    const l = interpretarModo("3 ROUNDS FOR TIME");
    expect(l.familia).toBe("rft");
    expect(l.rounds).toBe(3);
    expect(l.scoreSugerido).toBe("tempo");
  });

  it("4 e 5. 5 ROUNDS FOR TIME — DT, e o chipper do Murph", () => {
    expect(interpretarModo("5 ROUNDS FOR TIME").rounds).toBe(5);
    // Murph e FOR TIME puro: sem rounds prescritos, a familia muda.
    const murph = interpretarModo("FOR TIME");
    expect(murph.familia).toBe("for_time");
    expect(murph.rounds).toBeUndefined();
  });

  it("6. SKILL / STRENGTH — score e carga, nao tempo", () => {
    const l = interpretarModo("SKILL / STRENGTH");
    expect(l.familia).toBe("max_load");
    expect(l.scoreSugerido).toBe("carga");
  });

  it("7. EMOM (1'15\") x 4 — o modo fora de qualquer padrao", () => {
    const l = interpretarModo("EMOM (1'15\") x 4");
    expect(l.familia).toBe("emom");
    // 75s e a JANELA, nao a duracao do bloco.
    expect(l.intervaloSec).toBe(75);
    expect(l.rounds).toBe(4);
    expect(l.duracaoSec).toBe(300);
    expect(l.scoreSugerido).toBe("reps");
  });

  it("8. Fight Gone Bad — 3 rounds, 1 min por estacao", () => {
    const l = interpretarModo("3 ROUNDS, 1 MIN POR ESTACAO");
    expect(l.familia).toBe("intervalo");
    expect(l.rounds).toBe(3);
    expect(l.intervaloSec).toBe(60);
    expect(l.scoreSugerido).toBe("reps");
  });

  it("9. Death by Burpee — EMOM ate falhar, sem numero escrito", () => {
    const l = interpretarModo("EMOM ATE FALHAR");
    expect(l.familia).toBe("emom");
    expect(l.intervaloSec).toBe(60);
    // Nao ha rounds prescritos: o treino acaba quando a pessoa falha.
    expect(l.rounds).toBeUndefined();
    expect(l.duracaoSec).toBeUndefined();
  });

  it("10. o WOD de dupla — as tres partes e os descansos", () => {
    const a = interpretarModo("AMRAP 6'");
    expect(a.familia).toBe("amrap");
    expect(a.duracaoSec).toBe(360);

    const rest = interpretarModo("REST 1'");
    expect(rest.familia).toBe("descanso");
    expect(rest.duracaoSec).toBe(60);
    expect(rest.scoreSugerido).toBe("nenhum");

    const ft = interpretarModo("FOR TIME 7'");
    expect(ft.familia).toBe("for_time");
    // 7' e teto, nao alvo: quem estoura tem score capado, nao tempo.
    expect(ft.timeCapSec).toBe(420);
    expect(ft.duracaoSec).toBeUndefined();
  });
});

describe("o que nao pode acontecer", () => {
  it("nao reconheceu nao bloqueia — vira livre e o treino salva igual", () => {
    for (const modo of ["Aquecimento", "aquela parada do coach", "???", "Mobilidade"]) {
      const l = interpretarModo(modo);
      expect(l.familia).toBe("livre");
      expect(l.scoreSugerido).toBeNull();
    }
  });

  it("nao inventa numero que nao esta escrito", () => {
    // TABATA tem definicao canonica (20/10 x 8) e mesmo assim os campos ficam
    // vazios: numero inventado pelo app e indistinguivel de numero prescrito
    // pelo coach, e um deles nao pode virar recorde.
    const l = interpretarModo("TABATA");
    expect(l.familia).toBe("tabata");
    expect(l.rounds).toBeUndefined();
    expect(l.intervaloSec).toBeUndefined();
    expect(l.duracaoSec).toBeUndefined();
  });

  it("REST vem antes de tudo — o tempo dele nao vira duracao de trabalho", () => {
    // "REST 1'" tem um tempo que a regra do AMRAP sequestraria.
    expect(interpretarModo("REST 1'").familia).toBe("descanso");
    expect(interpretarModo("DESCANSO 90\"").duracaoSec).toBe(90);
  });

  it("toda leitura carrega a versao do interpretador", () => {
    // E o que permite varrer e reinterpretar tudo quando ele melhorar.
    expect(interpretarModo("AMRAP 8'").versao).toBe(1);
    expect(interpretarModo("qualquer coisa").versao).toBe(1);
  });

  it("caixa e acento nao mudam a leitura", () => {
    for (const modo of ["amrap 8'", "AMRAP 8'", "AmRap 8'"]) {
      expect(interpretarModo(modo).familia).toBe("amrap");
    }
    expect(interpretarModo("3 rounds, 1 min por estação").familia).toBe("intervalo");
  });
});
