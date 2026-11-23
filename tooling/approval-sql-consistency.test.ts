import { readFileSync } from "node:fs";
import path from "node:path";
import { approvalRule } from "@atps/core";
import { CHANGE_KINDS } from "@atps/schemas";
import { describe, expect, it } from "vitest";

// T09：資料庫 auto_apply_proposal 允許的變更種類必須等於第 2.6 節自動套用類別
const migration = readFileSync(
  path.resolve(import.meta.dirname, "../supabase/migrations/20261123100000_t09_apply_change.sql"),
  "utf8",
);

function sqlAutoKinds(): string[] {
  const fn = migration.slice(migration.indexOf("create function public.auto_apply_proposal"));
  const list = /not in \(([^)]*)\)/.exec(fn)?.[1];
  if (!list) throw new Error("找不到 auto_apply_proposal 的變更種類清單");
  return [...list.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? "").sort();
}

describe("自動套用類別與 SQL 一致（D10）", () => {
  it("auto_apply_proposal 的清單等於 approvalRule 的自動類別", () => {
    const coreAuto = CHANGE_KINDS.filter((k) => approvalRule(k).apply === "auto").sort();
    expect(sqlAutoKinds()).toEqual(coreAuto);
  });
});
