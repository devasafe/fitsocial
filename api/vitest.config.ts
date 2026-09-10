import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // O download do binário do Mongo em memória pode demorar na 1ª execução.
    hookTimeout: 120000,
    testTimeout: 30000,
    // Cada arquivo sobe o seu Mongo em memória. Numa máquina de 16 núcleos isso
    // vira 16 mongod ao mesmo tempo, e a suíte começa a falhar por disputa de
    // recurso — não por bug. O teto troca alguns segundos por resultado estável.
    poolOptions: { forks: { minForks: 1, maxForks: 8 } },
  },
});
