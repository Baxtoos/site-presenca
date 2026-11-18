import { defineConfig } from "vitest/config";

// Integração do worker: Postgres real em container (Testcontainers), com as migrations aplicadas.
export default defineConfig({
  test: {
    include: ["src/**/*.int.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
