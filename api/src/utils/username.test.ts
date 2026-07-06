import { describe, it, expect } from "vitest";
import { usernameSchema, normalizeUsername } from "./username.js";

describe("usernameSchema", () => {
  it("aceita usernames válidos", () => {
    for (const u of ["asafe", "joao_silva", "ze.dev", "user123"]) {
      expect(usernameSchema.safeParse(u).success).toBe(true);
    }
  });
  it("rejeita inválidos", () => {
    for (const u of ["ab", "a".repeat(21), "João", "com espaco", "-hifen", ".comeca", "termina.", "dois..pontos", "sinal!"]) {
      expect(usernameSchema.safeParse(u).success).toBe(false);
    }
  });
});

describe("normalizeUsername", () => {
  it("apara e coloca em minúsculas", () => {
    expect(normalizeUsername("  Asafe_DEV ")).toBe("asafe_dev");
  });
});
