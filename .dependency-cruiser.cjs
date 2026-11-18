/**
 * Barreira de arquitetura verificada no CI (pnpm lint:deps).
 * Regra 1 do planejamento: o navegador nunca fala com o banco.
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: "web-nao-acessa-banco",
      severity: "error",
      comment:
        "apps/web não pode importar packages/db nem drivers/ORMs de banco. Todo dado passa pela API.",
      from: { path: "^apps/web" },
      to: {
        path: [
          "^packages/db",
          "node_modules/(pg|pg-pool|postgres|drizzle-orm|drizzle-kit)/",
          "node_modules/\\.pnpm/(pg|pg-pool|postgres|drizzle-orm|drizzle-kit)@",
        ],
      },
    },
    {
      name: "pacotes-nao-dependem-de-apps",
      severity: "error",
      comment: "Pacotes compartilhados não podem importar código de apps.",
      from: { path: "^packages" },
      to: { path: "^apps" },
    },
    {
      name: "engine-puro",
      severity: "error",
      comment: "O motor de cálculo é puro: sem banco, sem rede, sem dependências externas.",
      // Arquivos de teste podem usar ferramentas de teste (vitest, fast-check); o código não.
      from: { path: "^packages/engine", pathNot: "\\.test\\.ts$" },
      to: {
        dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer", "core"],
      },
    },
    {
      name: "sem-ciclos",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(dist|\\.next|\\.turbo|coverage)/" },
    tsPreCompilationDeps: true,
    combinedDependencies: false,
    preserveSymlinks: false,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["types", "import", "require", "node", "default"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
      mainFields: ["types", "main"],
    },
  },
};
