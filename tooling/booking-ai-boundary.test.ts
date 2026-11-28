import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 決策 0010 B：預約碼不送 AI（S-01、S-07）。資料庫層 service_role 沒有預訂的權限（supabase/tests/29_bookings_lists.test.sql）；
// 這裡再檢查程式：組成 AI input 的模組（buildAiPayload、composeRoleInput、handleRoleRun、@atps/ai 與其相對 import）
// 不讀取預訂資料表、不出現預約碼欄位；core 的計算也不讀取預約碼。
// 決策 0010 I（匯入）是相反方向：使用者貼上的文字（可能含預約碼）由 AI 整理成預覽，預約碼只回到本人的預覽、確認後才存入預訂。
// 這些檔案只處理 AI「輸出」的預約碼，因此列為例外；不讀取預訂資料表的規則仍適用於所有檔案。

const root = resolve(import.meta.dirname, "..");
const READS_BOOKINGS = /from\(\s*["']bookings["']\s*\)/;
const CODE_FIELD = /confirmation_?[cC]ode/;
const IMPORT_OUTPUT = new Set(
  [
    "packages/core/src/import.ts",
    "packages/ai/src/injection/cases.ts",
    "apps/web/lib/server/import-fixture.ts",
  ].map((f) => join(root, f)),
);
const offends = (file: string) => {
  const source = readFileSync(file, "utf8");
  return READS_BOOKINGS.test(source) || (!IMPORT_OUTPUT.has(file) && CODE_FIELD.test(source));
};

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name === ".next" ? [] : sources(full);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

function resolveLocal(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  }
  return null;
}

function closure(entries: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const m of readFileSync(file, "utf8").matchAll(/(?:import|export)\s[^"']*?from\s+["'](\.[^"']+)["']|import\(\s*["'](\.[^"']+)["']\s*\)/g)) {
      const next = resolveLocal(file, m[1] ?? m[2] ?? "");
      if (next) visit(next);
    }
  };
  entries.forEach(visit);
  return seen;
}

const AI_ENTRY = /@atps\/ai|composeRoleInput|buildAiPayload|handleRoleRun|gateRoleOutput/;
const webAiEntries = [...sources(join(root, "apps/web/lib")), ...sources(join(root, "apps/web/workflows")), ...sources(join(root, "apps/web/app"))].filter((f) =>
  AI_ENTRY.test(readFileSync(f, "utf8")),
);

describe("預約碼不送 AI", () => {
  it("有 AI 入口的模組（含相對 import）不讀取預訂、不含預約碼", () => {
    expect(webAiEntries.length).toBeGreaterThan(3);
    const offending = [...closure(webAiEntries)].filter(offends).map((f) => relative(root, f));
    expect(offending).toEqual([]);
  });

  it("AI 套件、payload builder 與資料區塊不含預約碼", () => {
    const files = [...sources(join(root, "packages/ai/src")), join(root, "packages/security/src/payload.ts"), join(root, "packages/security/src/untrusted.ts")];
    expect(files.filter(offends).map((f) => relative(root, f))).toEqual([]);
  });

  it("core 與 memory 的計算不讀取預約碼", () => {
    const files = [...sources(join(root, "packages/core/src")), ...sources(join(root, "packages/memory/src"))];
    expect(files.filter(offends).map((f) => relative(root, f))).toEqual([]);
  });

  it("匯入的例外只限 AI 輸出：例外檔案不讀取預訂資料表，匯入的 AI input 只有貼上的文字", () => {
    for (const file of IMPORT_OUTPUT) expect(READS_BOOKINGS.test(readFileSync(file, "utf8")), relative(root, file)).toBe(false);
    const preview = readFileSync(join(root, "apps/web/lib/server/import-core.ts"), "utf8");
    expect(preview.match(/kind: "[a-z_]+"/g)).toEqual(['kind: "pasted_text"']);
    // 確認（寫入預訂）與 AI 的模組分開
    expect([...closure(webAiEntries)].map((f) => relative(root, f))).not.toContain("apps/web/lib/server/import-confirm.ts");
  });
});
