"use client";

import { normalizeShareCode } from "@presenca/contracts";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button, Field } from "@/components/ui";
import { formText } from "@/lib/form";

/** Digitar o código recebido (aceita minúsculas, hífen e as trocas O/0, I/1). */
export function CodeForm() {
  const router = useRouter();
  const [error, setError] = useState<string>();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = normalizeShareCode(formText(new FormData(event.currentTarget), "codigo"));
    if (!code) {
      setError("O código tem 8 letras e números (ex.: K7QM-2XPA).");
      return;
    }
    router.push(`/importar/${code}`);
  }

  return (
    <form method="post" onSubmit={onSubmit} className="grid gap-4" noValidate>
      <Field
        id="codigo"
        label="Código recebido"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="K7QM-2XPA"
        error={error}
      />
      <Button type="submit">Ver a grade</Button>
    </form>
  );
}
