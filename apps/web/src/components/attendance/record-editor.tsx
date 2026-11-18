"use client";

import type { AttendanceRecord, AttendanceResult } from "@presenca/contracts";
import { type FormEvent, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { REASON_LABEL, STATUS_LABEL, type AttendanceStatusKey } from "@/lib/format";

const selectClass =
  "min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-3 text-base";

/**
 * Corrige um registro: status (opcional), tempos perdidos na parcial, atestado, motivo e observação.
 * Grava com If-Match: se outro aparelho mudou antes, avisa em vez de sobrescrever.
 */
export function RecordEditor({
  record,
  allowStatus = false,
  onSaved,
  onCancel,
}: {
  record: AttendanceRecord;
  allowStatus?: boolean;
  onSaved: (result: AttendanceResult) => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState<AttendanceStatusKey>(record.status);
  const [unitsMissed, setUnitsMissed] = useState(
    record.status === "partial" ? record.unitsMissed : 1,
  );
  const [isExcused, setIsExcused] = useState(record.isExcused);
  const [reason, setReason] = useState(record.reason ?? "");
  const [note, setNote] = useState(record.note ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const absence = status === "absent" || status === "partial";
  const canPartial = record.unitsScheduled > 1;
  const id = `reg-${record.id}`;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const body: Record<string, unknown> = { note };
      if (allowStatus) body.status = status;
      if (status === "partial") body.unitsMissed = unitsMissed;
      if (absence) {
        body.isExcused = isExcused;
        body.reason = reason || null;
      }
      const result = await api<AttendanceResult>(`/v1/attendance/${record.id}`, {
        method: "PATCH",
        body,
        ifMatch: record.version,
      });
      onSaved(result);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (Object.values(e.fieldErrors)[0] ?? e.message)
          : "Não foi possível salvar.",
      );
      setPending(false);
    }
  }

  return (
    <form
      method="post"
      onSubmit={(e) => void onSubmit(e)}
      className="grid gap-3 rounded-xl bg-surface-2 p-3 text-sm"
      noValidate
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      {allowStatus ? (
        <label className="grid min-w-0 gap-1.5 font-medium" htmlFor={`${id}-status`}>
          O que aconteceu
          <select
            id={`${id}-status`}
            value={status}
            onChange={(e) => setStatus(e.target.value as AttendanceStatusKey)}
            className={selectClass}
          >
            {(Object.keys(STATUS_LABEL) as AttendanceStatusKey[])
              .filter((s) => s !== "partial" || canPartial)
              .map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
          </select>
        </label>
      ) : null}
      {status === "partial" ? (
        <label className="grid min-w-0 gap-1.5 font-medium" htmlFor={`${id}-tempos`}>
          Tempos perdidos (de {record.unitsScheduled})
          <select
            id={`${id}-tempos`}
            value={unitsMissed}
            onChange={(e) => setUnitsMissed(Number(e.target.value))}
            className={selectClass}
          >
            {Array.from({ length: record.unitsScheduled - 1 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {absence ? (
        <>
          <label className="grid min-w-0 gap-1.5 font-medium" htmlFor={`${id}-motivo`}>
            Motivo
            <select
              id={`${id}-motivo`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={selectClass}
            >
              <option value="">Sem motivo</option>
              {Object.entries(REASON_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2" htmlFor={`${id}-atestado`}>
            <input
              id={`${id}-atestado`}
              type="checkbox"
              checked={isExcused}
              onChange={(e) => setIsExcused(e.target.checked)}
              className="size-4 accent-accent"
            />
            Tenho atestado / falta abonada
          </label>
        </>
      ) : null}
      <label className="grid min-w-0 gap-1.5 font-medium" htmlFor={`${id}-obs`}>
        Observação
        <textarea
          id={`${id}-obs`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          className="w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-base"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending}>
          Salvar
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
