import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// O esbuild (padrão do Vitest) não emite metadados de decorators, que a injeção do Nest precisa.
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    include: ["src/**/*.spec.ts"],
    exclude: ["src/**/*.int.spec.ts"],
    environment: "node",
  },
});
