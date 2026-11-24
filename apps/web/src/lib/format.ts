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

/** "2026-11-18" → 3 (quarta), no padrão ISO (1 = segunda … 7 = domingo). Sem passar pelo fuso local. */
export function isoWeekdayOf(iso: string): number {
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** "2026-11-18" → "qua, 18/11" */
export function formatDayLabel(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${WEEKDAYS_SHORT[isoWeekdayOf(iso)]!.toLowerCase()}, ${d}/${m}`;
}

export type AttendanceStatusKey = "present" | "absent" | "partial" | "cancelled" | "no_call";

export const STATUS_LABEL: Record<AttendanceStatusKey, string> = {
  present: "Compareci",
  absent: "Faltei",
  partial: "Faltei (parcial)",
  cancelled: "Aula cancelada",
  no_call: "Sem chamada",
};

/** Explicação curta de cada status (dica dos botões). */
export const STATUS_HINT: Record<AttendanceStatusKey, string> = {
  present: "Você foi à aula.",
  absent: "Você faltou à aula inteira.",
  partial: "Você perdeu parte das aulas do dia.",
  cancelled: "A aula não aconteceu: sai da conta de aulas dadas.",
  no_call: "A aula aconteceu, mas o professor não fez chamada: conta como dada, sem falta.",
};

/** Classes por status (literais, para o Tailwind gerar). */
export const STATUS_STYLE: Record<AttendanceStatusKey, string> = {
  present: "bg-ok-soft text-ok",
  absent: "bg-fail-soft text-fail",
  partial: "bg-warn-soft text-warn",
  cancelled: "bg-surface-2 text-muted",
  no_call: "bg-accent-soft text-accent",
};

export const REASON_LABEL: Record<string, string> = {
  health: "Saúde",
  work: "Trabalho",
  transport: "Transporte",
  personal: "Pessoal",
  other: "Outro",
};

/** Uma frase curta do simulador para o card: quantas das próximas aulas ainda dá para faltar. */
export function simulateHint(sim: {
  nextClass: { date: string } | null;
  plan: { classes: number; untilDate: string | null };
  upcomingClasses: number;
}): string {
  if (!sim.nextClass) return "Não há mais aulas na grade deste semestre.";
  if (sim.plan.classes === 0)
    return `Faltar a próxima aula (${formatDayLabel(sim.nextClass.date)}) passa do limite.`;
  if (sim.plan.classes >= sim.upcomingClasses)
    return "Dá para faltar todas as aulas que restam sem reprovar.";
  const until = sim.plan.untilDate ? ` (até ${formatDayLabel(sim.plan.untilDate)})` : "";
  return `Dá para faltar as próximas ${plural(sim.plan.classes, "aula", "aulas")}${until}.`;
}
