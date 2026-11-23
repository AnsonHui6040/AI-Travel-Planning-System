import { z } from "zod";
import { canConfirmBaseline, checkBaseline, type BaselineIssue } from "@atps/core";
import { tripBaselineData } from "@atps/schemas";

// T23：基線矛盾檢查的評估場景（第 9.3 節 E5），場景檔在 evals/baseline/<編號>.json。
// 檢查是確定性規則，不呼叫 AI，所以不需要錄製回應，每個場景執行一次

const baselineScenarioSchema = z.strictObject({
  id: z.string().regex(/^E\d{1,2}$/),
  title: z.string().min(1).max(80),
  rule: z.string().min(1).max(200),
  baseline: tripBaselineData,
  expect: z.strictObject({
    // 必須標示的矛盾代碼（順序不拘），不可有其他矛盾
    conflicts: z.array(z.string().min(1).max(60)).max(20),
    confirmable: z.boolean(),
  }),
});
export type BaselineScenario = z.infer<typeof baselineScenarioSchema>;

export const parseBaselineScenario = (value: unknown): BaselineScenario => baselineScenarioSchema.parse(value);

export interface BaselineScenarioReport {
  scenario: BaselineScenario;
  issues: BaselineIssue[];
  conflicts: string[];
  confirmable: boolean;
  passed: boolean;
}

export function runBaselineScenario(scenario: BaselineScenario): BaselineScenarioReport {
  const issues = checkBaseline(scenario.baseline);
  const conflicts = issues.filter((i) => i.severity === "conflict").map((i) => i.code);
  const confirmable = canConfirmBaseline(scenario.baseline);
  const sameConflicts = [...conflicts].sort().join(",") === [...scenario.expect.conflicts].sort().join(",");
  return { scenario, issues, conflicts, confirmable, passed: sameConflicts && confirmable === scenario.expect.confirmable };
}

const cell = (s: string): string => s.replaceAll("|", "\\|").replaceAll("\n", " ");

export function renderBaselineReport(report: BaselineScenarioReport, meta: { date: string }): string {
  const { scenario } = report;
  const lines = [
    `# 評估報告：${scenario.id} ${scenario.title}`,
    "",
    "| 項目 | 內容 |",
    "|---|---|",
    `| 規則 | ${cell(scenario.rule)} |`,
    `| 日期 | ${meta.date} |`,
    "| 模式 | 確定性規則（不呼叫 AI） |",
    `| 預期矛盾 | ${scenario.expect.conflicts.join("、") || "沒有"} |`,
    `| 標示的矛盾 | ${report.conflicts.join("、") || "沒有"} |`,
    `| 可確認 | 預期 ${scenario.expect.confirmable ? "可" : "不可"}，實際 ${report.confirmable ? "可" : "不可"} |`,
    `| 結果 | ${report.passed ? "PASS" : "FAIL"} |`,
    "",
    "## 檢查結果",
    "",
    "| 類型 | 代碼 | 說明 |",
    "|---|---|---|",
    ...report.issues.map((i) => `| ${i.severity === "conflict" ? "矛盾" : "提醒"} | ${i.code} | ${cell(i.message)} |`),
    "",
  ];
  return lines.join("\n");
}
