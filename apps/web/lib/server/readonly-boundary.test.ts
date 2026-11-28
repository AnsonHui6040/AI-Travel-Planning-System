import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// T33（SH-08）：唯讀連結的請求不能觸發任何 AI 或付費 API。
// 從唯讀頁面出發，沿著所有 import 走訪，不得載入 AI、外部資料來源、背景 job、service role 或寫入用的模組；
// 頁面也不得有 Server Action。

const appDir = resolve(import.meta.dirname, "..", "..");
const ENTRY = join(appDir, "app", "r", "[token]", "page.tsx");

const FORBIDDEN_PACKAGES = ["@atps/ai", "@atps/data-sources", "@atps/db", "workflow", "workflow/api", "@anthropic-ai/sdk", "@google/genai", "openai"];
const FORBIDDEN_LOCAL = [/research/, /reverify/, /workflows\//, /api-keys/, /photos/];

function resolveLocal(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate) && candidate.match(/\.tsx?$/)) return candidate;
  }
  return null;
}

function walk(file: string, seen = new Set<string>()): { files: Set<string>; packages: Set<string> } {
  const packages = new Set<string>();
  const visit = (current: string) => {
    if (seen.has(current)) return;
    seen.add(current);
    const source = readFileSync(current, "utf8");
    for (const match of source.matchAll(/(?:import|export)\s[^"']*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g)) {
      const spec = match[1] ?? match[2] ?? match[3] ?? "";
      if (spec.startsWith(".")) {
        const next = resolveLocal(current, spec);
        if (next) visit(next);
      } else {
        packages.add(spec);
      }
    }
  };
  visit(file);
  return { files: seen, packages };
}

describe("唯讀連結頁面的依賴範圍", () => {
  const { files, packages } = walk(ENTRY);

  it("不載入 AI、外部資料來源、背景 job 或資料庫寫入套件", () => {
    expect([...packages].filter((p) => FORBIDDEN_PACKAGES.includes(p))).toEqual([]);
  });

  it("不載入研究、再核實、API key、照片等會呼叫外部服務的伺服器模組", () => {
    const local = [...files].map((f) => f.slice(appDir.length));
    expect(local.filter((f) => FORBIDDEN_LOCAL.some((re) => re.test(f)))).toEqual([]);
  });

  it("不使用 service role，也沒有 Server Action", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      // supabase.ts 內有定義，但不得被呼叫
      expect(/(?<!function )createSupabaseServiceClient\(/.test(source), file).toBe(false);
      expect(source.includes('"use server"'), file).toBe(false);
    }
  });

  it("走訪包含頁面與唯讀讀取模組", () => {
    const local = [...files].map((f) => f.slice(appDir.length));
    expect(local).toContain("/app/r/[token]/page.tsx");
    expect(local).toContain("/lib/server/readonly.ts");
  });
});

// 決策 0010 B：預約碼只有行程成員可見，不出現在唯讀連結（資料庫的 readonly_trip 也不讀取預訂，見 pgTAP 29）
describe("唯讀連結不讀取預訂", () => {
  it("頁面與其 import 不讀取預訂資料表、不含預約碼", () => {
    const { files } = walk(ENTRY);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(/from\(\s*["']bookings["']\s*\)|confirmation_?[cC]ode/.test(source), file).toBe(false);
    }
  });
});
