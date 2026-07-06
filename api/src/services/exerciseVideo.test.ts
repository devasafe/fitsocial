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

import { setYoutubeSearcher, getYoutubeSearcher, thumbnailFor } from "./exerciseVideo.js";

describe("youtube searcher (injeção)", () => {
  it("thumbnailFor monta a URL hqdefault", () => {
    expect(thumbnailFor("abc123")).toBe("https://img.youtube.com/vi/abc123/hqdefault.jpg");
  });

  it("getYoutubeSearcher retorna o searcher injetado", async () => {
    setYoutubeSearcher(async (q) => ({ youtubeId: "vid-" + q.length, title: "T " + q }));
    const hit = await getYoutubeSearcher()("agachamento execução correta");
    expect(hit).toEqual({ youtubeId: "vid-28", title: "T agachamento execução correta" });
    setYoutubeSearcher(null);
  });
});
