import { z } from "zod";
import { gateZoningOutput, type ZoningRejection } from "@atps/core";
import type { ZoningOutput } from "@atps/schemas";

// T27：地理分區的評估場景（第 9.3 節 E9），場景檔在 evals/zoning/<編號>.json。
// CI 以錄製的 AI 回應驗證判定器；第 9.1 節的合格條件是以真 AI 連續執行 5 次全部通過（旅前執行）。

const uuid = z.uuid();

const zoningScenarioSchema = z.strictObject({
  id: z.string().regex(/^E\d{1,2}$/),
  title: z.string().min(1).max(80),
  rule: z.string().min(1).max(200),
  base_area: z.string().min(1).max(80),
  candidates: z.array(z.strictObject({ id: uuid, name_zh: z.string().min(1).max(80), area: z.string().min(1).max(80) })).min(1).max(50),
  // 錄製的 AI 輸出（由 gateZoningOutput 檢查）
  recording: z.unknown(),
  expect: z.strictObject({
    same_zone_as_base: z.array(uuid).max(50),
    not_same_zone_as_base: z.array(uuid).max(50),
    transfers: z.record(z.string(), z.int().min(0).max(10)),
  }),
});
export type ZoningScenario = z.infer<typeof zoningScenarioSchema>;

export const parseZoningScenario = (value: unknown): ZoningScenario => zoningScenarioSchema.parse(value);

export interface ZoningCheck {
  label: string;
  passed: boolean;
}

export interface ZoningScenarioReport {
  scenario: ZoningScenario;
  gate: "ok" | ZoningRejection;
  checks: ZoningCheck[];
  passed: boolean;
}

export function runZoningScenario(scenario: ZoningScenario): ZoningScenarioReport {
  const gated = gateZoningOutput(scenario.recording, { knownItemIds: new Set(scenario.candidates.map((c) => c.id)), forbiddenValues: [] });
  if (!gated.ok) return { scenario, gate: gated.reason, checks: [], passed: false };

  const zones: ZoningOutput["zones"] = gated.output.zones;
  const name = (id: string) => scenario.candidates.find((c) => c.id === id)?.name_zh ?? id;
  const baseZone = zones.find((zone) => zone.base_area === scenario.base_area);
  const inBase = (id: string) => baseZone?.items.some((i) => i.item_id === id) ?? false;
  const transfersOf = (id: string) => zones.flatMap((zone) => zone.items).find((i) => i.item_id === id)?.transfers_from_base;

  const checks: ZoningCheck[] = [
    { label: `有包含出發地（${scenario.base_area}）的分區`, passed: baseZone !== undefined },
    ...scenario.expect.same_zone_as_base.map((id) => ({ label: `${name(id)}與出發地同區`, passed: inBase(id) })),
    ...scenario.expect.not_same_zone_as_base.map((id) => ({ label: `${name(id)}不在出發地分區`, passed: !inBase(id) })),
    ...Object.entries(scenario.expect.transfers).map(([id, n]) => ({
      label: `${name(id)}標示轉乘 ${n} 次`,
      passed: transfersOf(id) === n,
    })),
  ];
  return { scenario, gate: "ok", checks, passed: checks.every((c) => c.passed) };
}

const cell = (s: string): string => s.replaceAll("|", "\\|").replaceAll("\n", " ");

export function renderZoningReport(report: ZoningScenarioReport, meta: { date: string }): string {
  const { scenario } = report;
  return [
    `# 評估報告：${scenario.id} ${scenario.title}`,
    "",
    "| 項目 | 內容 |",
    "|---|---|",
    `| 規則 | ${cell(scenario.rule)} |`,
    `| 日期 | ${meta.date} |`,
    "| 模式 | 錄製回應（真 AI 5 次於旅前執行） |",
    `| 輸出檢查 | ${report.gate === "ok" ? "通過" : `拒絕（${report.gate}）`} |`,
    `| 結果 | ${report.passed ? "PASS" : "FAIL"} |`,
    "",
    "## 判定",
    "",
    "| 項目 | 結果 |",
    "|---|---|",
    ...report.checks.map((c) => `| ${cell(c.label)} | ${c.passed ? "PASS" : "FAIL"} |`),
    "",
  ].join("\n");
}
