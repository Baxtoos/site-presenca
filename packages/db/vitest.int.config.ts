import { defineConfig } from "vitest/config";

// Testes de integração: sobem um Postgres real em container (Testcontainers).
export default defineConfig({
  test: {
    include: ["src/**/*.int.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 180_000,
    // Um container por arquivo; arquivos em sequência para não disputar recursos no CI.
    fileParallelism: false,
  },
});
