// 出狀況的三個步驟（docs/verification/ux-logic-2026-11-27.md 第 6 節）

const STEPS = ["發生什麼事", "替代方案", "確認"] as const;

export function IncidentSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol aria-label="出狀況步驟" className="incident-steps">
      {STEPS.map((label, i) => (
        <li key={label} data-state={i + 1 < current ? "done" : i + 1 === current ? "current" : "todo"} aria-current={i + 1 === current ? "step" : undefined}>
          <span className="incident-step-number">{i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}
