import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { approvalRule } from "@atps/core";
import { CHANGE_KINDS } from "@atps/schemas";
import { describe, expect, it } from "vitest";

// 資料庫 auto_apply_proposal 允許的變更種類必須等於第 2.6 節自動套用類別（D10、決策 0005）
const DEFINITION = /create (?:or replace )?function public\.auto_apply_proposal/;
const dir = path.resolve(import.meta.dirname, "../supabase/migrations");

// 以最後一個定義此函式的 migration 為準
function latestDefinition(): string {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const sql = files.map((f) => readFileSync(path.join(dir, f), "utf8")).filter((s) => DEFINITION.test(s)).at(-1);
  if (!sql) throw new Error("找不到 auto_apply_proposal 的定義");
  return sql.slice(sql.search(DEFINITION));
}

function sqlAutoKinds(): string[] {
  const list = /not in \(([^)]*)\)/.exec(latestDefinition())?.[1];
  if (!list) throw new Error("找不到 auto_apply_proposal 的變更種類清單");
  return [...list.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? "").sort();
}

describe("自動套用類別與 SQL 一致（D10）", () => {
  it("auto_apply_proposal 的清單等於 approvalRule 的自動類別", () => {
    const coreAuto = CHANGE_KINDS.filter((k) => approvalRule(k).apply === "auto").sort();
    expect(sqlAutoKinds()).toEqual(coreAuto);
  });

  it("L1 與事實資料更正不在自動清單（決策 0005）", () => {
    expect(sqlAutoKinds()).not.toContain("incident_L1");
    expect(sqlAutoKinds()).not.toContain("fact_correction");
  });
});
