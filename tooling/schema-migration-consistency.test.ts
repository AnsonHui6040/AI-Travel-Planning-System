import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { tableSchemas } from "@atps/schemas";
import { describe, expect, it } from "vitest";

// T06：migration 建立的欄位必須與 Zod row schema 的鍵完全一致
const migrationsDir = path.resolve(import.meta.dirname, "../supabase/migrations");

function collectColumns(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const sql = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(path.join(migrationsDir, f), "utf8"))
    .join("\n")
    .replace(/--.*$/gm, "");

  for (const match of sql.matchAll(/create table public\.(\w+)\s*\(([\s\S]*?)\n\);/g)) {
    const [, table, body] = match;
    if (!table || body === undefined) continue;
    const columns = new Set<string>();
    for (const line of body.split("\n")) {
      const name = /^\s*(\w+)\s+/.exec(line)?.[1];
      if (name && !["primary", "check", "unique", "constraint", "foreign"].includes(name)) {
        columns.add(name);
      }
    }
    tables.set(table, columns);
  }
  for (const match of sql.matchAll(/alter table public\.(\w+)\s+add column (?:if not exists )?(\w+)/g)) {
    const [, table, column] = match;
    if (table && column) tables.get(table)?.add(column);
  }
  return tables;
}

describe("migration 與 schema 一致", () => {
  const columns = collectColumns();

  it("每個 schema 都有對應資料表，沒有多出未定義 schema 的資料表", () => {
    expect([...columns.keys()].sort()).toEqual(Object.keys(tableSchemas).sort());
  });

  it.each(Object.entries(tableSchemas))("%s 的欄位與 schema 鍵一致", (table, schema) => {
    const expected = Object.keys(schema.shape).sort();
    expect([...(columns.get(table) ?? [])].sort()).toEqual(expected);
  });
});
