export const THRESHOLDS = [50, 75, 90, 100] as const;
export type ThresholdPct = (typeof THRESHOLDS)[number];

export interface ThresholdState {
  pct: ThresholdPct;
  armed: boolean;
  cycle: number;
}

export interface ThresholdEvaluation {
  changes: ThresholdState[];
  notify: ThresholdState | null;
  skipped: ThresholdState[];
}

const initial = (pct: ThresholdPct): ThresholdState => ({ pct, armed: true, cycle: 0 });

export function evaluateThresholds(
  consumption: number,
  current: readonly ThresholdState[],
  wanted: readonly number[] = THRESHOLDS,
): ThresholdEvaluation {
  if (!Number.isInteger(consumption) || consumption < 0) {
    throw new RangeError(`consumo inválido: ${consumption}`);
  }
  const byPct = new Map(current.map((s) => [s.pct, s]));
  const changes: ThresholdState[] = [];
  const crossed: ThresholdState[] = [];

  for (const pct of THRESHOLDS) {
    const state = byPct.get(pct) ?? initial(pct);
    const reached = consumption >= pct;
    if (reached && state.armed) {
      const next = { pct, armed: false, cycle: state.cycle + 1 };
      changes.push(next);
      crossed.push(next);
    } else if (!reached && !state.armed) {
      changes.push({ ...state, armed: true });
    }
  }

  const eligible = crossed.filter((s) => wanted.includes(s.pct));
  const notify = eligible.length > 0 ? eligible[eligible.length - 1]! : null;
  return {
    changes,
    notify,
    skipped: eligible.filter((s) => s !== notify),
  };
}
