import { z } from "zod";
import { MORNING_CHECK_LABELS, morningCheck, type MorningCheckName } from "@atps/core";
import { availabilitySlot, enums, tripBaselineData } from "@atps/schemas";

// T36：Morning Check 的評估場景（第 9.3 節 E1 前段：At Risk 與 Standby），場景檔在 evals/morning/<編號>.json。
// 預報為錄製資料，判定是確定性規則，不呼叫 AI 或外部 API，每個場景執行一次

const key = z.string().regex(/^[a-z0-9-]{1,40}$/);

const morningScenarioSchema = z.strictObject({
  id: z.string().regex(/^E\d{1,2}$/),
  title: z.string().min(1).max(80),
  rule: z.string().min(1).max(200),
  date: z.iso.date(),
  baseline: tripBaselineData,
  items: z
    .array(
      z.strictObject({
        key,
        name_zh: z.string().min(1).max(80),
        type: enums.itemType,
        zone: z.string().min(1).max(40),
        weather_dependency: enums.level3,
        start: z.string().regex(/^\d{2}:\d{2}$/),
        end: z.string().regex(/^\d{2}:\d{2}$/),
        availability: z.array(availabilitySlot).max(50).default([]),
      }),
    )
    .min(1)
    .max(30),
  candidates: z
    .array(z.strictObject({ key, name_zh: z.string().min(1).max(80), zone: z.string().min(1).max(40), weather_dependency: enums.level3 }))
    .max(30),
  forecast: z.array(z.strictObject({ time: z.string(), precipitationProbability: z.number().nullable(), precipitationMm: z.number().nullable() })).max(400),
  expect: z.strictObject({ at_risk: z.array(key), standby: z.array(key), unaffected: z.array(key) }),
});
export type MorningScenario = z.infer<typeof morningScenarioSchema>;

export const parseMorningScenario = (value: unknown): MorningScenario => morningScenarioSchema.parse(value);

export interface MorningScenarioReport {
  scenario: MorningScenario;
  atRisk: string[];
  standby: string[];
  checks: Array<{ check: MorningCheckName; status: string; detail: string }>;
  passed: boolean;
}

const same = (a: readonly string[], b: readonly string[]) => [...a].sort().join(",") === [...b].sort().join(",");

export function runMorningScenario(scenario: MorningScenario): MorningScenarioReport {
  const result = morningCheck({
    date: scenario.date,
    baseline: scenario.baseline,
    items: scenario.items.map((i) => ({
      id: i.key,
      name_zh: i.name_zh,
      type: i.type,
      zone_id: i.zone,
      weather_dependency: i.weather_dependency,
      scheduled_start: i.start,
      scheduled_end: i.end,
      reservation_requirement: "none",
      availability: i.availability,
      at_risk: false,
    })),
    candidates: scenario.candidates.map((c) => ({
      id: c.key,
      name_zh: c.name_zh,
      zone_id: c.zone,
      weather_dependency: c.weather_dependency,
      verification_status: "verified",
      standby: false,
    })),
    weather: scenario.forecast,
    warnings: { maxLevel: 0, names: [] },
    transit: null,
    firstLegMinutes: null,
  });
  const atRisk = result.atRisk.map((r) => r.itemId);
  const unaffected = scenario.expect.unaffected.every((k) => !atRisk.includes(k));
  return {
    scenario,
    atRisk,
    standby: result.standby,
    checks: result.checks,
    passed: same(atRisk, scenario.expect.at_risk) && same(result.standby, scenario.expect.standby) && unaffected,
  };
}

const cell = (s: string): string => s.replaceAll("|", "\\|").replaceAll("\n", " ");

export function renderMorningReport(report: MorningScenarioReport, meta: { date: string }): string {
  const { scenario } = report;
  const name = (k: string) => scenario.items.find((i) => i.key === k)?.name_zh ?? scenario.candidates.find((c) => c.key === k)?.name_zh ?? k;
  return [
    `# 評估報告：${scenario.id} ${scenario.title}`,
    "",
    "| 項目 | 內容 |",
    "|---|---|",
    `| 規則 | ${cell(scenario.rule)} |`,
    `| 日期 | ${meta.date} |`,
    "| 模式 | 確定性規則（錄製的預報，不呼叫 AI 或外部 API） |",
    `| 結果 | ${report.passed ? "PASS" : "FAIL"} |`,
    `| At Risk | ${report.atRisk.map(name).join("、") || "沒有"} |`,
    `| Standby | ${report.standby.map(name).join("、") || "沒有"} |`,
    "",
    "## 檢查項目",
    "",
    "| 項目 | 狀態 | 說明 |",
    "|---|---|---|",
    ...report.checks.map((c) => `| ${MORNING_CHECK_LABELS[c.check]} | ${c.status} | ${cell(c.detail)} |`),
    "",
  ].join("\n");
}
