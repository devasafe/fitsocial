import { describe, it, expect } from "vitest";
import { slugify, slugDoExercicio } from "./slug.js";
import { chaveDoMovimento } from "./crossfit.js";

describe("slugify", () => {
  it("iguala o mesmo nome escrito de jeitos diferentes", () => {
    const esperado = "supino_reto";
    expect(slugify("Supino reto")).toBe(esperado);
    expect(slugify("supino reto")).toBe(esperado);
    expect(slugify("SUPINO RETO")).toBe(esperado);
    expect(slugify("  Supino   reto  ")).toBe(esperado);
  });

  it("tira acento", () => {
    expect(slugify("Flexão")).toBe("flexao");
    expect(slugify("Tríceps testa")).toBe("triceps_testa");
    expect(slugify("Abdômen")).toBe("abdomen");
  });

  it("colapsa pontuação em um separador só", () => {
    expect(slugify("Supino - reto")).toBe("supino_reto");
    expect(slugify("L-sit")).toBe("l_sit");
    expect(slugify("Agachamento (livre)")).toBe("agachamento_livre");
  });

  it("devolve vazio quando não sobra nada", () => {
    expect(slugify("")).toBe("");
    expect(slugify("   ")).toBe("");
    expect(slugify("---")).toBe("");
  });

  it("é o mesmo que chaveDoMovimento, que já era a chave do CrossFit", () => {
    for (const nome of ["Thruster", "Pull Up", "Double Under", "Toes-to-bar"]) {
      expect(slugify(nome)).toBe(chaveDoMovimento(nome));
    }
  });
});

describe("slugDoExercicio", () => {
  it("usa o id do catálogo quando a pessoa escolheu da lista", () => {
    expect(slugDoExercicio("qualquer coisa que ela digitou", "supino_reto")).toBe("supino_reto");
  });

  it("cai no nome quando o id não existe no catálogo", () => {
    expect(slugDoExercicio("Supino reto", "id_que_nao_existe")).toBe("supino_reto");
  });

  // Esta é a razão de a função existir: sem ela, quem ESCOLHEU "Flexão de braço"
  // da lista (id "flexao") e quem DIGITOU o mesmo nome ("flexao_de_braco")
  // teriam dois históricos separados do mesmo exercício.
  it("reconhece o nome do catálogo e usa o id dele", () => {
    expect(slugDoExercicio("Flexão de braço")).toBe("flexao");
    expect(slugDoExercicio("flexao de braco")).toBe("flexao");
    expect(slugDoExercicio("Flexão de braço", "flexao")).toBe("flexao");
  });

  it("reconhece o nome em inglês do catálogo", () => {
    expect(slugDoExercicio("Bench press")).toBe("supino_reto");
  });

  it("faz o slug do nome quando o exercício não está no catálogo", () => {
    expect(slugDoExercicio("Rosca martelo na polia")).toBe("rosca_martelo_na_polia");
  });

  it("devolve vazio quando não dá para identificar", () => {
    expect(slugDoExercicio("")).toBe("");
    expect(slugDoExercicio("   ", null)).toBe("");
  });
});
