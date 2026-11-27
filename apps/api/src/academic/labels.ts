import { schema, type Tx } from "@presenca/db";

export async function freeSemesterLabel(tx: Tx, wanted: string): Promise<string> {
  const rows = await tx.select({ label: schema.semesters.label }).from(schema.semesters);
  const taken = new Set(rows.map((r) => r.label));
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = `${wanted.slice(0, 60 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
