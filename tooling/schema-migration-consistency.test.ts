import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { enums, tableSchemas } from "@atps/schemas";
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

// 決策 0010：資料庫 enum 的值（含之後 alter type ... add value 加入的）必須與 packages/schemas 的同名 enum 一致
function collectEnums(): Map<string, string[]> {
  const sql = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(path.join(migrationsDir, f), "utf8"))
    .join("\n")
    .replace(/--.*$/gm, "");
  const types = new Map<string, string[]>();
  for (const match of sql.matchAll(/create type public\.(\w+) as enum \(([^)]*)\)/g)) {
    const [, name, body] = match;
    if (name && body !== undefined) types.set(name, [...body.matchAll(/'([^']+)'/g)].map((m) => m[1] as string));
  }
  for (const match of sql.matchAll(/alter type public\.(\w+) add value (?:if not exists )?'([^']+)'/g)) {
    const [, name, value] = match;
    if (name && value) types.get(name)?.push(value);
  }
  return types;
}

describe("migration 與 schema 的 enum 一致", () => {
  const camel = (name: string) => name.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
  const schemaEnums = enums as unknown as Record<string, { options?: readonly string[] } | undefined>;
  const pairs = [...collectEnums().entries()].filter(([name]) => schemaEnums[camel(name)]?.options);

  it("包含使用者確認與項目來源", () => {
    expect(pairs.map(([name]) => name)).toEqual(expect.arrayContaining(["verification_status", "item_origin"]));
  });

  it.each(pairs)("%s 的值與 schema 一致", (name, values) => {
    expect([...values].sort()).toEqual([...(schemaEnums[camel(name)]?.options ?? [])].sort());
  });
});
