/** Prévia ilustrativa de um card de matéria (telas de entrada e apresentação). Decorativa. */
export function SubjectPreviewCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={`card relative grid gap-3 overflow-hidden p-4 pt-5 shadow-sm ${className}`}
      aria-hidden
    >
      <span className="absolute inset-x-0 top-0 h-1.5 bg-[#3b82c4]" />
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <p className="font-semibold">Cálculo I</p>
          <p className="text-xs text-muted">Seg · Qua</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-md bg-ok-soft px-2 py-0.5 text-xs font-medium text-ok">
          <span className="size-1.5 rounded-full bg-current" />
          Seguro
        </span>
      </div>
      <div className="grid gap-1.5">
        <div className="flex items-baseline justify-between text-sm">
          <span>
            <strong className="text-xl font-semibold">4</strong>
            <span className="text-muted"> de 18 faltas</span>
          </span>
          <span className="text-xs text-muted">22% do limite</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full w-[22%] rounded-full bg-ok" />
        </div>
      </div>
      <p className="text-sm">
        Ainda pode faltar <strong>14 tempos</strong>
        <span className="text-muted"> (7 encontros)</span>.
      </p>
    </div>
  );
}
