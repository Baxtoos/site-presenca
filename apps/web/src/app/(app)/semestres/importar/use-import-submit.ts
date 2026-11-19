"use client";

import type { SemesterImportBody, SemesterImportResult } from "@presenca/contracts";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api, ApiError } from "@/lib/api-client";

/**
 * Envio da importação, comum às duas telas (planilha do app e planilha própria).
 * A Idempotency-Key acompanha o conteúdo: repetir o mesmo envio (rede caiu, clique duplo) reusa a
 * chave e não duplica; mudar qualquer coisa gera outra (a API recusaria a chave com outro corpo).
 */
export function useImportSubmit() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [fields, setFields] = useState<Record<string, string>>({});
  const last = useRef<{ json: string; key: string } | null>(null);

  async function submit(body: SemesterImportBody) {
    const json = JSON.stringify(body);
    if (last.current?.json !== json) last.current = { json, key: crypto.randomUUID() };
    setPending(true);
    setError(undefined);
    setFields({});
    try {
      const result = await api<SemesterImportResult>("/v1/imports/semester", {
        method: "POST",
        idempotencyKey: last.current.key,
        body,
      });
      router.push(`/semestres/${result.semesterId}`);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError) {
        const byField = e.fieldErrors;
        setFields({
          label: byField["semester.label"] ?? "",
          startsOn: byField["semester.startsOn"] ?? "",
          endsOn: byField["semester.endsOn"] ?? "",
        });
        const others = Object.entries(byField).filter(([path]) => !path.startsWith("semester."));
        setError(others[0]?.[1] ?? (Object.keys(byField).length === 0 ? e.message : undefined));
      } else {
        setError("Não foi possível importar.");
      }
      setPending(false);
    }
  }

  return { pending, error, fields, submit };
}
