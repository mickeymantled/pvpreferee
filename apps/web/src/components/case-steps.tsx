import React from "react";

const STEPS = ["Contracts", "Source", "Ruling"] as const;

export function CaseSteps({ current }: { current: (typeof STEPS)[number] }) {
  return (
    <ol className="case-steps" aria-label="Comparison steps">
      {STEPS.map((step, index) => (
        <li key={step} aria-current={step === current ? "step" : undefined}>
          <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          {step}
        </li>
      ))}
    </ol>
  );
}
