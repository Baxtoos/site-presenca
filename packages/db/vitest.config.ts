import { defineConfig } from "vitest/config";

// Testes unitários. Os de integração (*.int.test.ts) rodam com vitest.int.config.ts.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.int.test.ts"],
    environment: "node",
  },
});
