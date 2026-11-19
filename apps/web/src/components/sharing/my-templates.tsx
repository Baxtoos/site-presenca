"use client";

import { formatShareCode, type SharedTemplate } from "@presenca/contracts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api-client";
import { importUrl } from "./share-panel";

const STATUS: Record<SharedTemplate["status"], { label: string; style: string }> = {
  active: { label: "Ativo", style: "bg-ok-soft text-ok" },
  expired: { label: "Expirado", style: "bg-surface-2 text-muted" },
  revoked: { label: "Revogado", style: "bg-surface-2 text-muted" },
  exhausted: { label: "Esgotado", style: "bg-warn-soft text-warn" },
};

/** Códigos que você gerou: quantas pessoas importaram, validade, copiar e revogar. */
export function MyTemplates({ templates }: { templates: SharedTemplate[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string>();

  async function revoke(t: SharedTemplate) {
    if (
      !window.confirm(
        `Revogar o código ${formatShareCode(t.code)}? Quem já importou continua com a cópia.`,
      )
    )
      return;
    setBusy(t.id);
    try {
      await api(`/v1/templates/${t.id}`, { method: "DELETE" });
      toast.push({ message: "Código revogado." });
      router.refresh();
    } catch (e) {
      toast.push({
        tone: "error",
        message: e instanceof ApiError ? e.message : "Não foi possível revogar.",
      });
    } finally {
      setBusy(undefined);
    }
  }

  if (templates.length === 0) {
    return (
      <div className="grid gap-2 rounded-xl border border-dashed border-line bg-surface p-6 text-sm">
        <p className="font-medium">Você ainda não compartilhou nenhuma grade.</p>
        <p className="text-muted">
          Abra um semestre ou uma matéria e use “Gerar código para colegas”. Quem receber o código
          cria a própria cópia, sem ver suas faltas.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid gap-3" aria-label="Seus códigos">
      {templates.map((t) => (
        <li key={t.id} className="grid gap-2 card p-4 text-sm" data-testid="meu-codigo">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="grid min-w-0 gap-0.5">
              <strong className="truncate">{t.title}</strong>
              <span className="text-xs text-muted">
                {t.kind === "semester" ? "Semestre" : "Matéria"}
                {t.institution ? ` · ${t.institution}` : ""}
                {t.course ? ` · ${t.course}` : ""}
              </span>
            </div>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS[t.status].style}`}
            >
              {STATUS[t.status].label}
            </span>
          </div>
          <p className="font-mono text-lg font-bold tracking-widest">{formatShareCode(t.code)}</p>
          <p className="text-xs text-muted">
            {t.usesCount} {t.usesCount === 1 ? "importação" : "importações"}
            {t.maxUses ? ` de ${t.maxUses}` : ""}
            {t.expiresAt ? ` · vale até ${new Date(t.expiresAt).toLocaleDateString("pt-BR")}` : ""}
          </p>
          {t.status === "active" ? (
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                className="min-h-9 rounded-lg px-2 font-medium text-accent hover:bg-accent-soft"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(importUrl(t.code))
                    .then(() => toast.push({ tone: "success", message: "Link copiado." }))
                    .catch(() => toast.push({ tone: "error", message: "Não deu para copiar." }))
                }
              >
                Copiar link
              </button>
              <button
                type="button"
                disabled={busy === t.id}
                className="min-h-9 rounded-lg px-2 font-medium text-fail hover:bg-fail-soft disabled:opacity-60"
                onClick={() => void revoke(t)}
                aria-label={`Revogar o código ${t.code}`}
              >
                Revogar
              </button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
