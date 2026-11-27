import { requireInt } from "./rules";

export type Risk = "safe" | "warning" | "critical" | "limit" | "failed";

export const RISK_ORDER: readonly Risk[] = ["safe", "warning", "critical", "limit", "failed"];

export function riskLevel(absent: number, max: number, unitsPerClass: number): Risk {
  requireInt("absent", absent, 0);
  requireInt("max", max, 0);
  requireInt("unitsPerClass", unitsPerClass, 1);
  if (absent > max) return "failed";
  if (absent === max) return "limit";
  const classesLeft = Math.floor((max - absent) / unitsPerClass);
  if (absent * 100 >= max * 75 || (absent > 0 && classesLeft <= 2)) return "critical";
  if (absent * 100 >= max * 50) return "warning";
  return "safe";
}

/** Presença em %, truncada em 1 casa decimal (74,96% vira 74,9%, nunca 75,0%). */
export function presencePct(total: number, absent: number): number {
  requireInt("total", total, 0);
  requireInt("absent", absent, 0);
  if (total === 0) return 0;
  return Math.max(0, Math.floor(((total - absent) * 1000) / total) / 10);
}

export const projectedPresence = presencePct;

export function consumptionPct(absent: number, max: number): number {
  requireInt("absent", absent, 0);
  requireInt("max", max, 0);
  if (max === 0) return absent > 0 ? 100 : 0;
  return Math.floor((absent * 100) / max);
}
