import { z } from "zod";
import { FEASIBILITY_CHECKS, FEASIBILITY_LABELS, planFeasibleDays, type FeasibilityCheck, type FeasibilityItem } from "@atps/core";
import { availabilitySlot, enums, tripBaselineData } from "@atps/schemas";

// T30：可行性驗證的評估場景（第 9.3 節 E3），場景檔在 evals/feasibility/<編號>.json。
// 排程與可行性驗證是確定性規則，不呼叫 AI，所以不需要錄製回應，每個場景執行一次

const check = z.enum(FEASIBILITY_CHECKS);

const scenarioItem = z.strictObject({
  key: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name_zh: z.string().min(1).max(80),
  type: enums.itemType,
  zone: z.string().min(1).max(40),
  priority: z.int().min(1).max(5).default(3),
  stay_minutes: z.int().min(5).max(600).default(60),
  verification_status: enums.verificationStatus.default("verified"),
  availability: z.array(availabilitySlot).max(50).default([]),
});

const feasibilityScenarioSchema = z.strictObject({
  id: z.string().regex(/^E\d{1,2}$/),
  title: z.string().min(1).max(80),
  rule: z.string().min(1).max(200),
  baseline: tripBaselineData,
  items: z.array(scenarioItem).min(1).max(50),
  expect: z
    .array(
      z.strictObject({
        key: z.string(),
        // 排入的日期；null 表示留在 Candidate List
        placed_on: z.string().nullable(),
        // 留在 Candidate List 時的原因（回到地理分區時標示的檢查項目）
        returned_for: check.nullable().default(null),
      }),
    )
    .min(1)
    .max(50),
});
export type FeasibilityScenario = z.infer<typeof feasibilityScenarioSchema>;

export const parseFeasibilityScenario = (value: unknown): FeasibilityScenario => feasibilityScenarioSchema.parse(value);

export interface FeasibilityExpectationReport {
  key: string;
  name: string;
  placedOn: string | null;
  returnedFor: FeasibilityCheck[];
  passed: boolean;
}

export interface FeasibilityScenarioReport {
  scenario: FeasibilityScenario;
  results: FeasibilityExpectationReport[];
  passed: boolean;
}

export function runFeasibilityScenario(scenario: FeasibilityScenario): FeasibilityScenarioReport {
  const items: FeasibilityItem[] = scenario.items.map((i) => ({
    id: i.key,
    name_zh: i.name_zh,
    type: i.type,
    suggested_stay_minutes: i.stay_minutes,
    priority: i.priority,
    candidate_role: "primary",
    verification_status: i.verification_status,
    zone_id: i.zone,
    score_time_slot_dependency: 4,
    availability: i.availability,
    reservation_requirement: "none",
    weather_dependency: "low",
  }));
  const plan = planFeasibleDays({ baseline: scenario.baseline, items, segment: () => null });
  const results = scenario.expect.map((e) => {
    const placedOn = plan.days.find((d) => d.entries.some((x) => x.kind === "item" && x.item_id === e.key))?.date ?? null;
    const returnedFor = plan.returned.filter((r) => r.item_id === e.key).flatMap((r) => r.checks);
    const returnedOk = e.placed_on !== null || e.returned_for === null || returnedFor.includes(e.returned_for);
    return {
      key: e.key,
      name: scenario.items.find((i) => i.key === e.key)?.name_zh ?? e.key,
      placedOn,
      returnedFor,
      passed: placedOn === e.placed_on && returnedOk,
    };
  });
  return { scenario, results, passed: results.every((r) => r.passed) };
}

const cell = (s: string): string => s.replaceAll("|", "\\|").replaceAll("\n", " ");

export function renderFeasibilityReport(report: FeasibilityScenarioReport, meta: { date: string }): string {
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
    "## 項目",
    "",
    "| 項目 | 排入日期 | 留在 Candidate List 的原因 | 結果 |",
    "|---|---|---|---|",
    ...report.results.map(
      (r) =>
        `| ${cell(r.name)} | ${r.placedOn ?? "沒有排入"} | ${r.returnedFor.map((c) => FEASIBILITY_LABELS[c]).join("、") || "沒有"} | ${r.passed ? "PASS" : "FAIL"} |`,
    ),
    "",
  ].join("\n");
}
