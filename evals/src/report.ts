import { ROLE_NAMES } from "@atps/core";
import type { ScenarioReport } from "./runner";

// T15：評估報告，輸出至 docs/verification/evals/<日期>-<場景>.md

export interface ReportMeta {
  date: string;
  // recorded：錄製回應，沒有呼叫供應商；live：真 AI
  mode: "recorded" | "live";
}

const verdict = (pass: boolean): string => (pass ? "PASS" : "FAIL");
const cell = (s: string): string => s.replaceAll("|", "\\|").replaceAll("\n", " ");

export function renderReport(report: ScenarioReport, meta: ReportMeta): string {
  const { scenario, runs } = report;
  const lines = [
    `# 評估報告：${scenario.id} ${scenario.title}`,
    "",
    "| 項目 | 內容 |",
    "|---|---|",
    `| 規則 | ${cell(scenario.rule)} |`,
    `| 日期 | ${meta.date} |`,
    `| 模式 | ${meta.mode === "recorded" ? "錄製回應" : "真 AI"} |`,
    `| 角色 | ${ROLE_NAMES[scenario.role]} |`,
    `| 執行次數 | ${runs.length} |`,
    `| 結果 | ${verdict(report.passed)} |`,
    "",
    "## 每次結果",
    "",
    "| 次 | 狀態 | 結果 | 供應商與模型 | 未通過的判定 |",
    "|---|---|---|---|---|",
    ...runs.map((r) => {
      const failed = r.judges.filter((j) => !j.pass).map((j) => j.judge);
      const reason = r.note ?? (failed.length ? failed.join("、") : "無");
      const model = meta.mode === "recorded" ? "未呼叫（錄製回應）" : r.provider ? `${r.provider} ${r.model ?? ""}`.trim() : "無";
      return `| ${r.attempt} | ${r.status} | ${verdict(r.passed)} | ${cell(model)} | ${cell(reason)} |`;
    }),
  ];
  const failures = runs.flatMap((r) => r.judges.filter((j) => !j.pass).map((j) => ({ attempt: r.attempt, ...j })));
  if (failures.length > 0) {
    lines.push("", "## 未通過明細", "", "| 次 | 判定 | 說明 |", "|---|---|---|");
    for (const f of failures) lines.push(`| ${f.attempt} | ${f.judge} | ${cell(f.detail)} |`);
  }
  return `${lines.join("\n")}\n`;
}
