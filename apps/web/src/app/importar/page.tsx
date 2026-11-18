import type { Metadata } from "next";
import { CodeForm } from "./code-form";

export const metadata: Metadata = { title: "Importar grade · Monitor de Presenças" };

export default function ImportCodePage() {
  return (
    <section className="grid gap-6 rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
      <header className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Importar grade de um colega</h1>
        <p className="text-sm text-muted">
          Digite o código que recebeu. Você vê as matérias, os horários e as regras de falta antes
          de importar.
        </p>
      </header>
      <CodeForm />
    </section>
  );
}
