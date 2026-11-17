import { describe, expect, it } from "vitest";
import { renderEmail } from "./render";
import { ThresholdAlertEmail } from "./threshold-alert";

describe("ThresholdAlertEmail", () => {
  it("renderiza matéria, contagem e saldo", () => {
    const html = renderEmail(
      <ThresholdAlertEmail
        studentName="Ana"
        subjectName="Cálculo II"
        thresholdPct={75}
        absentUnits={14}
        maxUnits={18}
        remainingClasses={2}
        appUrl="https://app.exemplo/"
      />,
    );
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("Cálculo II: 75% do limite de faltas");
    expect(html).toContain("Restam 4 tempos");
  });
});
