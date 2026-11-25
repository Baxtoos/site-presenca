"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface StepSeries {
  name: string;
  /** Cor da linha (variável CSS do tema). */
  color: string;
  /** Tracejada: segunda forma de diferenciar, além da cor. */
  dashed?: boolean;
  /** Valor depois de cada data (escada: o valor vale até a próxima data). */
  points: { date: string; value: number }[];
}

const DAY = 86_400_000;
const toTime = (d: string) => Date.parse(`${d}T12:00:00Z`);
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dayLabel = (d: string) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;

/** Valor de uma série numa data: o do último ponto até ela (antes do primeiro, nenhum). */
function valueAt(points: StepSeries["points"], date: string): number | null {
  let v: number | null = null;
  for (const p of points) {
    if (p.date > date) break;
    v = p.value;
  }
  return v;
}

/**
 * Gráfico de escada ao longo do semestre, num eixo só: as séries mudam nas datas dos pontos e a
 * linha de referência (limite, nota para passar) fica tracejada com rótulo. Passar o dedo ou o
 * mouse mostra os valores do dia; a tabela logo abaixo traz os mesmos números para leitores de tela.
 */
export function StepChart({
  title,
  start,
  end,
  today,
  yMax,
  reference,
  series,
  format,
}: {
  title: string;
  start: string;
  end: string;
  today: string;
  yMax: number;
  reference: { label: string; value: number };
  series: StepSeries[];
  format: (v: number) => string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const titleId = useId();
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = 190;
  const m = { top: 12, right: 12, bottom: 24, left: 36 };
  const w = Math.max(0, width - m.left - m.right);
  const h = height - m.top - m.bottom;
  const t0 = toTime(start);
  const t1 = Math.max(toTime(end), t0 + DAY);
  const last = today < end ? (today > start ? today : start) : end;
  const x = (d: string) => m.left + ((toTime(d) - t0) / (t1 - t0)) * w;
  const top = Math.max(yMax, reference.value) * 1.1 || 1;
  const y = (v: number) => m.top + h - (v / top) * h;

  const path = (points: StepSeries["points"]) => {
    if (points.length === 0) return "";
    let d = `M${x(points[0]!.date)},${y(points[0]!.value)}`;
    for (let i = 1; i < points.length; i++) {
      d += `H${x(points[i]!.date)}V${y(points[i]!.value)}`;
    }
    return `${d}H${x(last)}`;
  };
  // Referência primeiro: perto dela, o rótulo dela vence o da grade.
  const ticks = [reference.value, 0, yMax, Math.round(yMax / 2)].filter(
    (v, i, all) => all.findIndex((o) => Math.abs(o - v) < top * 0.12) === i,
  );
  // Só o dia 1 de cada mês (o início do semestre perto do dia 1 sobreporia o rótulo).
  const months: string[] = [];
  const first = new Date(t0);
  first.setUTCDate(1);
  for (let d = first; d.getTime() <= t1; d.setUTCMonth(d.getUTCMonth() + 1, 1)) {
    if (d.getTime() >= t0) months.push(d.toISOString().slice(0, 10));
  }

  const onMove = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || w <= 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - m.left) / w));
    const date = new Date(t0 + ratio * (t1 - t0)).toISOString().slice(0, 10);
    setHover(date > last ? last : date);
  };
  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();

  return (
    <figure className="grid gap-2" aria-labelledby={titleId}>
      <figcaption id={titleId} className="text-sm font-medium">
        {title}
      </figcaption>
      {series.length > 1 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legenda">
          {series.map((s) => (
            <li key={s.name} className="inline-flex items-center gap-1.5">
              <svg width="18" height="6" aria-hidden>
                <line
                  x1="0"
                  y1="3"
                  x2="18"
                  y2="3"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeDasharray={s.dashed ? "4 3" : undefined}
                />
              </svg>
              {s.name}
            </li>
          ))}
        </ul>
      ) : null}
      <div
        ref={box}
        className="relative touch-pan-y select-none"
        style={{ height }}
        onPointerMove={(e) => onMove(e.clientX)}
        onPointerDown={(e) => onMove(e.clientX)}
        onPointerLeave={() => setHover(null)}
        aria-hidden
      >
        {width > 0 ? (
          <svg width={width} height={height} className="block overflow-visible">
            {ticks.map((v) => (
              <g key={v}>
                <line
                  x1={m.left}
                  x2={m.left + w}
                  y1={y(v)}
                  y2={y(v)}
                  stroke="var(--color-line)"
                  strokeWidth="1"
                />
                <text
                  x={m.left - 6}
                  y={y(v)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-muted text-[11px] tabular-nums"
                >
                  {format(v)}
                </text>
              </g>
            ))}
            {months.map((d) => (
              <text
                key={d}
                x={x(d)}
                y={height - 6}
                className="fill-muted text-[11px]"
                textAnchor="middle"
              >
                {MONTHS[Number(d.slice(5, 7)) - 1]}
              </text>
            ))}
            <line
              x1={m.left}
              x2={m.left + w}
              y1={y(reference.value)}
              y2={y(reference.value)}
              stroke="var(--color-muted)"
              strokeWidth="1.5"
              strokeDasharray="5 4"
            />
            <text
              x={m.left + w}
              y={y(reference.value) - 5}
              textAnchor="end"
              className="fill-muted text-[11px] font-medium"
            >
              {reference.label}
            </text>
            {series.map((s) => (
              <g key={s.name}>
                <path
                  d={path(s.points)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeDasharray={s.dashed ? "6 4" : undefined}
                />
                {s.points.map((p) => (
                  <circle
                    key={p.date}
                    cx={x(p.date)}
                    cy={y(p.value)}
                    r="4"
                    fill={s.color}
                    stroke="var(--color-surface)"
                    strokeWidth="2"
                  />
                ))}
              </g>
            ))}
            {hover ? (
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={m.top}
                y2={m.top + h}
                stroke="var(--color-line-strong)"
                strokeWidth="1"
              />
            ) : null}
          </svg>
        ) : null}
        {hover ? (
          <div
            className="pointer-events-none absolute top-1 z-10 grid min-w-32 gap-0.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-pop"
            style={x(hover) > width / 2 ? { right: width - x(hover) + 8 } : { left: x(hover) + 8 }}
          >
            <span className="font-medium">{dayLabel(hover)}</span>
            {series.map((s) => {
              const v = valueAt(s.points, hover);
              return (
                <span key={s.name} className="flex items-center gap-1.5 text-muted">
                  <span className="size-2 rounded-full" style={{ background: s.color }} />
                  {s.name}:{" "}
                  <span className="text-ink tabular-nums">{v === null ? "—" : format(v)}</span>
                </span>
              );
            })}
          </div>
        ) : null}
      </div>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer">Ver em tabela</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col" className="py-1 font-medium">
                Data
              </th>
              {series.map((s) => (
                <th key={s.name} scope="col" className="py-1 font-medium">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dates.map((d) => (
              <tr key={d} className="border-t border-line">
                <td className="py-1">{dayLabel(d)}</td>
                {series.map((s) => {
                  const v = valueAt(s.points, d);
                  return (
                    <td key={s.name} className="py-1 text-ink">
                      {v === null ? "—" : format(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1">
          {reference.label}. Período: {dayLabel(start)} a {dayLabel(end)}.
        </p>
      </details>
    </figure>
  );
}
