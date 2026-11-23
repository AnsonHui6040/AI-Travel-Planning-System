import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { parseRecording, parseScenario, renderReport, replayInvoker, runScenario } from "./src/index";

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

it("有要執行的場景", () => {
  expect(files.length).toBeGreaterThan(0);
});

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
