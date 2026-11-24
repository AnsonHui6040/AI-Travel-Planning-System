import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  parseBaselineScenario,
  parseCrossCheckScenario,
  parseFeasibilityScenario,
  parseZoningScenario,
  parseRecording,
  parseScenario,
  renderBaselineReport,
  renderCrossCheckReport,
  renderFeasibilityReport,
  renderZoningReport,
  renderReport,
  replayInvoker,
  runBaselineScenario,
  runCrossCheckScenario,
  runFeasibilityScenario,
  runZoningScenario,
  runScenario,
} from "./src/index";

// T15：執行評估並把報告寫入 docs/verification/evals/。
// 用法：pnpm evals:run（全部場景）；EVAL_SCENARIOS=E6 pnpm evals:run（指定場景）。
// 目前只支援錄製回應；以真 AI 執行需在伺服器端取使用者本人的 key（roleInvoker），旅前接上。

const root = join(import.meta.dirname, "..");
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const outDir = join(root, "docs", "verification", "evals");
const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date());

const wanted = process.env.EVAL_SCENARIOS?.split(",").map((s) => s.trim());
const files = readdirSync(join(import.meta.dirname, "scenarios"))
  .filter((f) => f.endsWith(".json"))
  .filter((f) => !wanted || wanted.includes(f.replace(/\.json$/, "")));

// T23：基線矛盾檢查場景（確定性規則，不呼叫 AI）
const baselineFiles = readdirSync(join(import.meta.dirname, "baseline"))
  .filter((f) => f.endsWith(".json"))
  .filter((f) => !wanted || wanted.includes(f.replace(/\.json$/, "")));

// T25：交叉核查場景（確定性規則，不呼叫 AI）
const crossCheckFiles = readdirSync(join(import.meta.dirname, "crosscheck"))
  .filter((f) => f.endsWith(".json"))
  .filter((f) => !wanted || wanted.includes(f.replace(/\.json$/, "")));

// T27：地理分區場景（錄製回應）
const zoningFiles = readdirSync(join(import.meta.dirname, "zoning"))
  .filter((f) => f.endsWith(".json"))
  .filter((f) => !wanted || wanted.includes(f.replace(/\.json$/, "")));

// T30：可行性驗證場景（確定性規則，不呼叫 AI）
const feasibilityFiles = readdirSync(join(import.meta.dirname, "feasibility"))
  .filter((f) => f.endsWith(".json"))
  .filter((f) => !wanted || wanted.includes(f.replace(/\.json$/, "")));

it("有要執行的場景", () => {
  expect(files.length + baselineFiles.length + crossCheckFiles.length + zoningFiles.length + feasibilityFiles.length).toBeGreaterThan(0);
});

for (const file of feasibilityFiles) {
  it(`評估 ${file}`, () => {
    const report = runFeasibilityScenario(parseFeasibilityScenario(read(join(import.meta.dirname, "feasibility", file))));
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `${date}-${report.scenario.id}.md`), renderFeasibilityReport(report, { date }));
    expect(report.passed).toBe(true);
  });
}

for (const file of zoningFiles) {
  it(`評估 ${file}`, () => {
    const report = runZoningScenario(parseZoningScenario(read(join(import.meta.dirname, "zoning", file))));
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `${date}-${report.scenario.id}.md`), renderZoningReport(report, { date }));
    expect(report.passed).toBe(true);
  });
}

for (const file of crossCheckFiles) {
  it(`評估 ${file}`, () => {
    const report = runCrossCheckScenario(parseCrossCheckScenario(read(join(import.meta.dirname, "crosscheck", file))));
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `${date}-${report.scenario.id}.md`), renderCrossCheckReport(report, { date }));
    expect(report.passed).toBe(true);
  });
}

for (const file of baselineFiles) {
  it(`評估 ${file}`, () => {
    const report = runBaselineScenario(parseBaselineScenario(read(join(import.meta.dirname, "baseline", file))));
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `${date}-${report.scenario.id}.md`), renderBaselineReport(report, { date }));
    expect(report.passed).toBe(true);
  });
}

for (const file of files) {
  it(`評估 ${file}`, async () => {
    const scenario = parseScenario(read(join(import.meta.dirname, "scenarios", file)));
    const recording = parseRecording(read(join(import.meta.dirname, "recordings", file)));
    const report = await runScenario(scenario, replayInvoker(recording.responses));
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `${date}-${scenario.id}.md`), renderReport(report, { date, mode: "recorded" }));
    expect(report.passed).toBe(true);
  });
}
