// @ts-check
import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Pacotes que dão acesso ao banco. O app web nunca pode importá-los. */
const DATABASE_IMPORTS = [
  { name: "@presenca/db", message: "O web não acessa o banco. Chame a API pelo proxy /api." },
  { name: "pg", message: "O web não acessa o banco. Chame a API pelo proxy /api." },
  { name: "postgres", message: "O web não acessa o banco. Chame a API pelo proxy /api." },
];
const DATABASE_PATTERNS = [
  { group: ["drizzle-orm", "drizzle-orm/*"], message: "O web não acessa o banco." },
  { group: ["**/packages/db/**"], message: "O web não acessa o banco." },
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/next-env.d.ts",
      "packages/db/migrations/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      eqeqeq: ["error", "always"],
      "no-console": "off",
    },
  },
  {
    // Regras que usam o compilador: promises esquecidas, await em não-promise, uso inseguro de any.
    files: ["{apps,packages}/*/src/**/*.{ts,tsx}"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    // Nos testes, respostas HTTP vêm como any e são validadas pelos schemas logo em seguida.
    files: ["**/*.{spec,test}.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
  {
    // O Nest usa os tipos dos parâmetros do construtor em tempo de execução (metadados de
    // decorators); importá-los como "type" quebraria a injeção de dependência.
    files: ["apps/api/**/*.ts"],
    rules: { "@typescript-eslint/consistent-type-imports": "off" },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    settings: { next: { rootDir: "apps/web" } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": ["error", { paths: DATABASE_IMPORTS, patterns: DATABASE_PATTERNS }],
    },
  },
  {
    // Service worker: JS puro servido como está, roda no escopo do worker (self, caches, clients).
    files: ["apps/web/public/sw.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.serviceworker } },
  },
  prettier,
);
