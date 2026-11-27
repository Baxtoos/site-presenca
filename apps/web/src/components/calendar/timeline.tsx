"use client";

import type { Task } from "@presenca/contracts";
import { useMemo, useState } from "react";
import { INPUT_CLASS } from "@/components/ui";
import { dayLong } from "@/lib/calendar";
import { TaskRow } from "./task-row";

type Grouping = "data" | "materia";

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export function Timeline({ tasks, emptyText }: { tasks: Task[]; emptyText: string }) {
  const [query, setQuery] = useState("");
  const [grouping, setGrouping] = useState<Grouping>("data");

  const groups = useMemo(() => {
    const q = normalize(query.trim());
    const found = q
      ? tasks.filter((t) =>
          normalize([t.title, t.subject?.name ?? "", t.subject?.code ?? ""].join(" ")).includes(q),
        )
      : tasks;
    const map = new Map<string, { label: string; items: Task[] }>();
    for (const t of found) {
      const [key, label] =
        grouping === "data"
          ? [t.dueLocal.date, dayLong(t.dueLocal.date)]
          : [t.subject?.id ?? "", t.subject?.name ?? "Sem matéria"];
      const group = map.get(key) ?? { label, items: [] };
      group.items.push(t);
      map.set(key, group);
    }
    const list = [...map.entries()];
    if (grouping === "materia") {
      list.sort(([a, ga], [b, gb]) =>
        a === "" ? 1 : b === "" ? -1 : ga.label.localeCompare(gb.label, "pt-BR"),
      );
    }
    return list;
  }, [tasks, query, grouping]);

  const toggle = (value: Grouping, label: string) => (
    <button
      type="button"
      aria-pressed={grouping === value}
      onClick={() => setGrouping(value)}
      className={`min-h-9 rounded-md px-3 text-sm transition-colors ${grouping === value ? "bg-surface font-medium text-ink shadow-sm" : "text-muted hover:text-ink"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label
          className="grid w-full min-w-0 gap-1.5 text-sm font-medium sm:w-auto sm:flex-1"
          htmlFor="busca-tarefa"
        >
          Buscar
          <input
            id="busca-tarefa"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Título ou matéria"
            className={INPUT_CLASS}
          />
        </label>
        <div
          role="group"
          aria-label="Organizar"
          className="flex rounded-lg border border-line bg-surface-2 p-0.5"
        >
          {toggle("data", "Ordenar por data")}
          {toggle("materia", "Agrupar por matéria")}
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="card p-5 text-sm text-muted">
          {query.trim() ? "Nenhuma tarefa encontrada com essa busca." : emptyText}
        </p>
      ) : (
        groups.map(([key, group]) => (
          <section key={key || "sem-materia"} className="grid gap-1.5" aria-label={group.label}>
            <h3 className="text-sm font-semibold first-letter:uppercase">{group.label}</h3>
            <ul className="card divide-y divide-line overflow-hidden">
              {group.items.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  showDate={
                    grouping === "materia"
                      ? t.dueLocal.date.split("-").reverse().slice(0, 2).join("/")
                      : undefined
                  }
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
