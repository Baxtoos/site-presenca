import { defineConfig } from "vitest/config";

// Testes unitários (sem banco). Os de integração ficam em vitest.int.config.ts.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.int.test.ts"],
    environment: "node",
  },
});
