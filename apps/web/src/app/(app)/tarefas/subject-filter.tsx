"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { INPUT_CLASS } from "@/components/ui";

export function SubjectFilter({ subjects }: { subjects: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const value = params.get("materia") ?? "";
  return (
    <label
      className="grid min-w-0 gap-1.5 text-sm font-medium sm:max-w-xs"
      htmlFor="filtro-materia"
    >
      Matéria
      <select
        id="filtro-materia"
        value={value}
        className={INPUT_CLASS}
        onChange={(e) => {
          const next = new URLSearchParams(params);
          if (e.target.value) next.set("materia", e.target.value);
          else next.delete("materia");
          const query = next.toString();
          router.push(query ? `${pathname}?${query}` : pathname);
        }}
      >
        <option value="">Todas as matérias</option>
        {subjects.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}
