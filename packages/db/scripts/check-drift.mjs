// Falha se o schema (src/schema) mudou sem migration correspondente.
// Roda o gerador do drizzle-kit e compara a pasta de migrations antes e depois; se algo foi gerado,
// desfaz (para não deixar lixo) e sai com erro. Não depende do git: funciona com migrations ainda
// não commitadas.  Uso: pnpm db:check
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const migrations = join(root, "migrations");

function snapshot(dir) {
  const files = new Map();
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      for (const [k, v] of snapshot(path)) files.set(k, v);
    } else {
      files.set(relative(migrations, path), readFileSync(path));
    }
  }
  return files;
}

const before = snapshot(migrations);
execFileSync("pnpm", ["exec", "drizzle-kit", "check"], { cwd: root, stdio: "inherit" });
execFileSync("pnpm", ["exec", "drizzle-kit", "generate", "--name=drift"], {
  cwd: root,
  stdio: ["ignore", "ignore", "inherit"],
});
const after = snapshot(migrations);

const created = [...after.keys()].filter((f) => !before.has(f));
const changed = [...before.keys()].filter(
  (f) => after.has(f) && !after.get(f).equals(before.get(f)),
);

if (created.length === 0 && changed.length === 0) {
  console.log("Migrations em dia com o schema.");
  process.exit(0);
}

for (const f of created) rmSync(join(migrations, f));
for (const f of changed) writeFileSync(join(migrations, f), before.get(f));
console.error(
  "O schema mudou sem migration. Rode `pnpm --filter @presenca/db db:generate` e revise o SQL.\n" +
    `Arquivos que seriam gerados: ${[...created, ...changed].join(", ")}`,
);
process.exit(1);
