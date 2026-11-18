import type { SubjectSummaryDto } from "@presenca/contracts";

export const WEEKDAYS = [
  "",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
  "Domingo",
] as const;
export const WEEKDAYS_SHORT = ["", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"] as const;

/** 7550 → "75,5%" (sem casas desnecessárias). */
export function bpToPercent(bp: number): string {
  return `${(bp / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

/** "75,5" ou "75.5" → 7550. NaN se não for número. */
export function percentToBp(input: string): number {
  return Math.round(Number(input.replace(",", ".")) * 100);
}

/** Número digitado com vírgula ou ponto → número (NaN se inválido). */
export function parseDecimal(input: string): number {
  return input.trim() === "" ? Number.NaN : Number(input.replace(",", "."));
}

/** "2026-08-03" → "03/08/2026" (sem passar por Date, para não mudar de dia por fuso). */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export const RISK_LABEL: Record<SubjectSummaryDto["risk"], string> = {
  safe: "Seguro",
  warning: "Atenção",
  critical: "Alerta crítico",
  limit: "Limite atingido",
  failed: "Reprovado por falta",
};

/** Classes literais (o Tailwind só gera o que aparece escrito no código). */
export const RISK_STYLE: Record<SubjectSummaryDto["risk"], { badge: string; bar: string }> = {
  safe: { badge: "bg-ok-soft text-ok", bar: "bg-ok" },
  warning: { badge: "bg-warn-soft text-warn", bar: "bg-warn" },
  critical: { badge: "bg-crit-soft text-crit", bar: "bg-crit" },
  limit: { badge: "bg-fail-soft text-fail", bar: "bg-fail" },
  failed: { badge: "bg-fail-soft text-fail ring-1 ring-fail", bar: "bg-fail" },
};

/** Cor de identificação de cada matéria (faixa no card). */
export const SUBJECT_COLOR_CLASS: Record<string, string> = {
  blue: "bg-[#3b82c4]",
  violet: "bg-[#7c5cc4]",
  amber: "bg-[#c99a2e]",
  teal: "bg-[#2e9c94]",
  rose: "bg-[#c4566f]",
  green: "bg-[#4c9a4f]",
  orange: "bg-[#d0743a]",
  slate: "bg-[#64748b]",
};

export const SUBJECT_COLOR_NAME: Record<string, string> = {
  blue: "Azul",
  violet: "Violeta",
  amber: "Âmbar",
  teal: "Verde-água",
  rose: "Rosa",
  green: "Verde",
  orange: "Laranja",
  slate: "Cinza",
};

/** "tempo"/"tempos", "encontro"/"encontros". */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
