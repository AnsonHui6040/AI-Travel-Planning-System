import { z } from "zod";
import { canEnterDraft, crossCheck, type VerificationStatus } from "@atps/core";
import { enums, factClaimRecord, modelRef } from "@atps/schemas";

// T25：交叉核查的評估場景（第 9.3 節 E4），場景檔在 evals/crosscheck/<編號>.json。
// 依證據順序判定是確定性規則，不呼叫 AI，所以不需要錄製回應，每個場景執行一次

const caseSchema = z.strictObject({
  title: z.string().min(1).max(80),
  item: z.strictObject({ generated_by: modelRef, fact_claims: z.array(factClaimRecord).max(50) }),
  verification: z.strictObject({ status: enums.verificationStatus, verified_by: modelRef, facts: z.array(factClaimRecord).max(10) }),
  expect: z.strictObject({
    status: enums.verificationStatus,
    // 欄位 → 採用的值；conflict 時為 null
    adopted: z.partialRecord(enums.factField, z.string().nullable()),
    can_enter_draft: z.boolean(),
  }),
});

const crossCheckScenarioSchema = z.strictObject({
  id: z.string().regex(/^E\d{1,2}$/),
  title: z.string().min(1).max(80),
  rule: z.string().min(1).max(200),
  cases: z.array(caseSchema).min(1).max(20),
});
export type CrossCheckScenario = z.infer<typeof crossCheckScenarioSchema>;

export const parseCrossCheckScenario = (value: unknown): CrossCheckScenario => crossCheckScenarioSchema.parse(value);

export interface CrossCheckCaseReport {
  title: string;
  status: VerificationStatus;
  adopted: Partial<Record<string, string | null>>;
  canEnterDraft: boolean;
  passed: boolean;
}

export interface CrossCheckScenarioReport {
  scenario: CrossCheckScenario;
  cases: CrossCheckCaseReport[];
  passed: boolean;
}

export function runCrossCheckScenario(scenario: CrossCheckScenario): CrossCheckScenarioReport {
  const cases = scenario.cases.map((c) => {
    const result = crossCheck(c.item, { status: c.verification.status, facts: c.verification.facts, verifiedBy: c.verification.verified_by });
    const adopted = Object.fromEntries(result.facts.map((f) => [f.field, f.value]));
    const enter = canEnterDraft(result.status);
    const adoptedOk = Object.entries(c.expect.adopted).every(([field, value]) => (adopted[field] ?? null) === value);
    return {
      title: c.title,
      status: result.status,
      adopted,
      canEnterDraft: enter,
      passed: result.status === c.expect.status && adoptedOk && enter === c.expect.can_enter_draft,
    };
  });
  return { scenario, cases, passed: cases.every((c) => c.passed) };
}

const STATUS_LABELS: Record<VerificationStatus, string> = {
  verified: "Verified",
  partially_verified: "Partially Verified",
  unverified: "Unverified",
  conflict: "Conflict",
  user_confirmed: "使用者確認",
};

const cell = (s: string): string => s.replaceAll("|", "\\|").replaceAll("\n", " ");

export function renderCrossCheckReport(report: CrossCheckScenarioReport, meta: { date: string }): string {
  const { scenario } = report;
  return [
    `# 評估報告：${scenario.id} ${scenario.title}`,
    "",
    "| 項目 | 內容 |",
    "|---|---|",
    `| 規則 | ${cell(scenario.rule)} |`,
    `| 日期 | ${meta.date} |`,
    "| 模式 | 確定性規則（不呼叫 AI） |",
    `| 結果 | ${report.passed ? "PASS" : "FAIL"} |`,
    "",
    "## 案例",
    "",
    "| 案例 | 核實狀態 | 採用的事實 | 可進入行程 | 結果 |",
    "|---|---|---|---|---|",
    ...report.cases.map((c) => {
      const facts = Object.entries(c.adopted).map(([field, value]) => `${field}：${value ?? "無法判定"}`).join("、") || "沒有";
      return `| ${cell(c.title)} | ${STATUS_LABELS[c.status]} | ${cell(facts)} | ${c.canEnterDraft ? "可" : "不可"} | ${c.passed ? "PASS" : "FAIL"} |`;
    }),
    "",
  ].join("\n");
}
