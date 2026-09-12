import { describe, it, expect } from "vitest";
import { resolveMuscle, muscleOf, isMuscleGroup, MUSCLE_GROUPS, PALAVRAS } from "./muscleGroups.js";
import { EXERCISES } from "./exercisesCatalog.js";

describe("muscleOf — nome exato do catálogo", () => {
  it("resolve todo exercício do catálogo pelo próprio nome", () => {
    for (const ex of EXERCISES) {
      expect(muscleOf(ex.name), ex.name).toBe(ex.muscle);
    }
  });

  it("resolve pelo nome em inglês", () => {
    expect(muscleOf("Bench press")).toBe("Peito");
    expect(muscleOf("Back squat")).toBe("Quadríceps");
    expect(muscleOf("Standing calf raise")).toBe("Panturrilha");
  });

  it("ignora acento e caixa", () => {
    expect(muscleOf("AGACHAMENTO LIVRE")).toBe("Quadríceps");
    expect(muscleOf("triceps testa")).toBe("Tríceps");
    expect(muscleOf("  Panturrilha em pé  ")).toBe("Panturrilha");
  });
});

describe("muscleOf — palavra-chave no nome digitado à mão", () => {
  it("acha o músculo dentro de um nome que não está no catálogo", () => {
    expect(muscleOf("Supino inclinado com halter na máquina smith")).toBe("Peito");
    expect(muscleOf("Remada cavalinho pegada neutra")).toBe("Costas");
    expect(muscleOf("Rosca martelo no banco 45")).toBe("Bíceps");
    expect(muscleOf("Elevação lateral sentado")).toBe("Ombro");
    expect(muscleOf("Abdominal infra na paralela")).toBe("Abdômen");
  });

  it("não deixa uma palavra curta de outro grupo roubar o termo composto", () => {
    // "coice" é glúteo e vem antes; sem o conserto, isto era Glúteo no card.
    expect(muscleOf("Tríceps coice com halter")).toBe("Tríceps");
    expect(muscleOf("Coice de tríceps na polia")).toBe("Tríceps");
    // "remada" é costas e vem antes.
    expect(muscleOf("Remada alta na polia")).toBe("Trapézio");
    // "crucifixo" e "voador" são peito e vêm antes.
    expect(muscleOf("Crucifixo inverso na máquina")).toBe("Ombro");
    expect(muscleOf("Voador inverso")).toBe("Ombro");
    expect(muscleOf("Peck deck inverso")).toBe("Ombro");
    // "rosca" é bíceps e vem antes; "flexão" é peito e vem antes.
    expect(muscleOf("Rosca francesa")).toBe("Tríceps");
    expect(muscleOf("Flexão abdominal")).toBe("Abdômen");
  });

  it("INVARIANTE: nenhum termo de PALAVRAS é roubado por um grupo anterior", () => {
    // Este é o teste que teria pego o bug acima. Ele fecha a CLASSE, não o
    // caso: vale sozinho quando a lista crescer. Se falhar, o termo novo não
    // pertence a PALAVRAS — pertence a ESPECIFICOS, que é conferido antes.
    const roubados: string[] = [];

    PALAVRAS.forEach(([grupo, termos], i) => {
      for (const termo of termos) {
        for (const [grupoAnterior, anteriores] of PALAVRAS.slice(0, i)) {
          const ladrao = anteriores.find((a) => termo.includes(a));
          if (ladrao) {
            roubados.push(`"${termo}" (${grupo}) é capturado por "${ladrao}" (${grupoAnterior})`);
          }
        }
      }
    });

    expect(roubados).toEqual([]);
  });

  it("prefere o específico ao genérico", () => {
    // "panturrilha no leg press" tem as duas palavras; a perna não rouba.
    expect(muscleOf("Panturrilha no leg press")).toBe("Panturrilha");
    // Stiff é posterior, mesmo sendo primo do terra.
    expect(muscleOf("Stiff com barra")).toBe("Posterior de coxa");
    expect(muscleOf("Mesa flexora unilateral")).toBe("Posterior de coxa");
    expect(muscleOf("Elevação pélvica no banco")).toBe("Glúteo");
  });

  it("devolve null quando não dá para saber — chutar é pior que não mostrar", () => {
    expect(muscleOf("maquina nova da academia")).toBeNull();
    expect(muscleOf("aquele aparelho do canto")).toBeNull();
    expect(muscleOf("")).toBeNull();
  });
});

describe("resolveMuscle — ordem de confiança", () => {
  it("o que a pessoa marcou ganha do nome", () => {
    expect(resolveMuscle({ name: "Supino reto", muscle: "Ombro" })).toBe("Ombro");
    expect(resolveMuscle({ name: "maquina nova da academia", muscle: "Costas" })).toBe("Costas");
  });

  it("um músculo inválido é ignorado e o nome decide", () => {
    expect(resolveMuscle({ name: "Supino reto", muscle: "Peitoral maior" })).toBe("Peito");
    expect(resolveMuscle({ name: "Supino reto", muscle: null })).toBe("Peito");
  });

  it("o id do catálogo ganha do nome quando não há marcação", () => {
    expect(resolveMuscle({ name: "escrevi errado", exerciseId: "panturrilha_pe" })).toBe(
      "Panturrilha"
    );
  });

  it("id desconhecido não atrapalha — cai no nome", () => {
    expect(resolveMuscle({ name: "Agachamento livre", exerciseId: "nao_existe" })).toBe(
      "Quadríceps"
    );
  });
});

describe("isMuscleGroup", () => {
  it("aceita só o vocabulário fechado", () => {
    for (const g of MUSCLE_GROUPS) expect(isMuscleGroup(g)).toBe(true);
    expect(isMuscleGroup("Peitoral")).toBe(false);
    expect(isMuscleGroup("peito")).toBe(false); // caixa importa: é valor gravado
    expect(isMuscleGroup(null)).toBe(false);
    expect(isMuscleGroup(42)).toBe(false);
  });
});
