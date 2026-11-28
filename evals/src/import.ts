import { z } from "zod";
import { gateImportOutput, importPreviewRows, type ImportRejection } from "@atps/core";
import { buildImportPayload } from "@atps/security";

// 決策 0010 I：行程匯入的評估場景，場景檔在 evals/import/<編號>.json。
// CI 以錄製的 AI 回應驗證：貼上的文字送出前移除全名、電話、電子郵件；輸出經 gateImportOutput；預覽列的預訂與地點正確。
// 合格條件與其他場景相同：以真 AI 連續執行 5 次全部通過（旅前執行）。

const importScenarioSchema = z.strictObject({
  id: z.string().regex(/^E\d{1,2}$/),
  title: z.string().min(1).max(80),
  rule: z.string().min(1).max(300),
  trip: z.strictObject({ timezone: z.string().min(1), dates: z.array(z.iso.date()).min(1).max(60) }),
  known_values: z.array(z.string().min(1)).max(20),
  pasted: z.string().min(1).max(20_000),
  // 錄製的 AI 輸出（由 gateImportOutput 檢查）
  recording: z.unknown(),
  expect: z.strictObject({
    not_sent: z.array(z.string().min(1)).max(20),
    sent: z.array(z.string().min(1)).max(20),
    bookings: z.array(z.record(z.string(), z.union([z.string(), z.boolean()]))).max(20),
    places: z.array(z.record(z.string(), z.string())).max(30),
  }),
});
export type ImportScenario = z.infer<typeof importScenarioSchema>;

export const parseImportScenario = (value: unknown): ImportScenario => importScenarioSchema.parse(value);

export interface ImportCheck {
  label: string;
  passed: boolean;
}

export interface ImportScenarioReport {
  scenario: ImportScenario;
  gate: "ok" | ImportRejection;
  checks: ImportCheck[];
  passed: boolean;
}

const matches = (row: object, expected: Record<string, string | boolean>) =>
  Object.entries(expected).every(([k, v]) => (row as Record<string, unknown>)[k] === v);

export function runImportScenario(scenario: ImportScenario): ImportScenarioReport {
  const sent = buildImportPayload(scenario.pasted, { knownValues: scenario.known_values }).text;
  // 報告不列出個資本身，只列編號
  const privacy: ImportCheck[] = [
    ...scenario.expect.not_sent.map((v, i) => ({ label: `個資第 ${i + 1} 項沒有送出`, passed: !sent.includes(v) })),
    ...scenario.expect.sent.map((v) => ({ label: `保留「${v}」供辨識`, passed: sent.includes(v) })),
  ];
  const gated = gateImportOutput(scenario.recording, { forbiddenValues: scenario.known_values });
  if (!gated.ok) return { scenario, gate: gated.reason, checks: privacy, passed: false };

  const rows = importPreviewRows(gated.output, scenario.trip);
  const checks: ImportCheck[] = [
    ...privacy,
    { label: `預訂 ${scenario.expect.bookings.length} 筆`, passed: rows.bookings.length === scenario.expect.bookings.length },
    ...scenario.expect.bookings.map((b, i) => ({ label: `預訂：${String(b.title ?? i + 1)}`, passed: rows.bookings[i] !== undefined && matches(rows.bookings[i], b) })),
    { label: `地點 ${scenario.expect.places.length} 個`, passed: rows.places.length === scenario.expect.places.length },
    ...scenario.expect.places.map((p, i) => ({ label: `地點：${p.name ?? i + 1}`, passed: rows.places[i] !== undefined && matches(rows.places[i], p) })),
  ];
  return { scenario, gate: "ok", checks, passed: checks.every((c) => c.passed) };
}

const cell = (s: string): string => s.replaceAll("|", "\\|").replaceAll("\n", " ");

export function renderImportReport(report: ImportScenarioReport, meta: { date: string }): string {
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
