/**
 * Marcos de alerta (50/75/90/100% do limite de faltas) com rearme.
 *
 * Cada marco de cada matéria guarda `armed` e `cycle`:
 * - armado e cruzado → desarma, `cycle + 1` e gera alerta (um por ciclo, nunca repetido);
 * - desarmado e o consumo cai abaixo dele (falta apagada, abonada ou corrigida) → rearma, para
 *   avisar de novo se o aluno voltar a cruzar.
 * Se vários marcos são cruzados de uma vez (ex.: de 45% para 80%), só o mais grave é enviado; os
 * outros ficam registrados como pulados, para não mandar três avisos seguidos.
 */

export const THRESHOLDS = [50, 75, 90, 100] as const;
export type ThresholdPct = (typeof THRESHOLDS)[number];

export interface ThresholdState {
  pct: ThresholdPct;
  armed: boolean;
  cycle: number;
}

export interface ThresholdEvaluation {
  /** Estados que mudaram (para gravar). Inclui marcos que ainda não tinham linha no banco. */
  changes: ThresholdState[];
  /** Marco a avisar agora (o mais grave cruzado entre os que o aluno quer receber), ou null. */
  notify: ThresholdState | null;
  /** Outros marcos cruzados nesta mesma mudança: registrados, mas sem envio. */
  skipped: ThresholdState[];
}

const initial = (pct: ThresholdPct): ThresholdState => ({ pct, armed: true, cycle: 0 });

/**
 * @param consumption % do limite já usado (inteiro, como `consumptionPct` do motor).
 * @param current estados gravados (marcos sem linha contam como armados, ciclo 0).
 * @param wanted marcos que o aluno quer receber (preferências). Os outros mudam de estado, mas
 *   nunca geram aviso.
 */
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
