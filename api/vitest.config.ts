import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // O download do binário do Mongo em memória pode demorar na 1ª execução.
    hookTimeout: 120000,
    testTimeout: 30000,
  },
});
