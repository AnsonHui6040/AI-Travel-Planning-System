import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 決策 0010 B：預約碼不送 AI（S-01、S-07）。資料庫層 service_role 沒有預訂的權限（supabase/tests/29_bookings_lists.test.sql）；
// 這裡再檢查程式：組成 AI input 的模組（buildAiPayload、composeRoleInput、handleRoleRun、@atps/ai 與其相對 import）
// 不讀取預訂資料表、不出現預約碼欄位；core 的計算也不讀取預約碼。

const root = resolve(import.meta.dirname, "..");
const FORBIDDEN = [/from\(\s*["']bookings["']\s*\)/, /confirmation_?[cC]ode/];

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
    const offending = [...closure(webAiEntries)].filter((f) => FORBIDDEN.some((re) => re.test(readFileSync(f, "utf8")))).map((f) => relative(root, f));
    expect(offending).toEqual([]);
  });

  it("AI 套件、payload builder 與資料區塊不含預約碼", () => {
    const files = [...sources(join(root, "packages/ai/src")), join(root, "packages/security/src/payload.ts"), join(root, "packages/security/src/untrusted.ts")];
    expect(files.filter((f) => FORBIDDEN.some((re) => re.test(readFileSync(f, "utf8")))).map((f) => relative(root, f))).toEqual([]);
  });

  it("core 與 memory 的計算不讀取預約碼", () => {
    const files = [...sources(join(root, "packages/core/src")), ...sources(join(root, "packages/memory/src"))];
    expect(files.filter((f) => FORBIDDEN.some((re) => re.test(readFileSync(f, "utf8")))).map((f) => relative(root, f))).toEqual([]);
  });
});
