import { CONSTRAINT_CATEGORY_LABELS, type BaselineConstraint, type BaselineIssue, type ConstraintCategory } from "@atps/core";

// T23：限制分類與檢查結果（表單即時顯示與唯讀檢視共用）

const ORDER: ConstraintCategory[] = ["hard", "strong_preference", "flexible"];

export function ConstraintGroups({ constraints }: { constraints: readonly BaselineConstraint[] }) {
  return (
    <section aria-labelledby="constraints-heading" className="baseline-panel">
      <h2 id="constraints-heading">限制分類</h2>
      {ORDER.map((category) => {
        const items = constraints.filter((c) => c.category === category);
        return (
          <div key={category} className="constraint-group">
            <h3>{CONSTRAINT_CATEGORY_LABELS[category]}</h3>
            {items.length === 0 ? (
              <p className="muted">沒有</p>
            ) : (
              <ul aria-label={CONSTRAINT_CATEGORY_LABELS[category]}>
                {items.map((c, i) => (
                  <li key={`${c.kind}:${i}`}>{c.label}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}

export function IssueList({ issues }: { issues: readonly BaselineIssue[] }) {
  const conflicts = issues.filter((i) => i.severity === "conflict");
  const warnings = issues.filter((i) => i.severity === "warning");
  return (
    <section aria-labelledby="issues-heading" className="baseline-panel">
      <h2 id="issues-heading">矛盾檢查</h2>
      {issues.length === 0 ? <p className="muted">沒有發現矛盾。</p> : null}
      {conflicts.length > 0 ? (
        <ul aria-label="矛盾" className="issues conflict">
          {conflicts.map((i, n) => (
            <li key={`${i.code}:${n}`}>
              <strong>矛盾</strong>
              {i.message}
            </li>
          ))}
        </ul>
      ) : null}
      {warnings.length > 0 ? (
        <ul aria-label="提醒" className="issues warning">
          {warnings.map((i, n) => (
            <li key={`${i.code}:${n}`}>
              <strong>提醒</strong>
              {i.message}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
