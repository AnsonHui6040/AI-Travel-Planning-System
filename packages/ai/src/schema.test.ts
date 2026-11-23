import { describe, expect, it } from "vitest";
import { defaultKeyTesters, defaultProviders, extractJson, stripInjectedNulls, toProviderSchema } from "./index";

const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 50, pattern: "^.+$" },
    stay: { type: "integer", minimum: 10, maximum: 600 },
    date: { type: "string", format: "date" },
    note: { type: "string" },
    tags: { type: "array", items: { type: "string", enum: ["a", "b"] }, minItems: 1, maxItems: 3 },
    nested: {
      type: "object",
      properties: { url: { type: "string", format: "uri" } },
      required: ["url"],
      additionalProperties: true,
    },
  },
  required: ["name", "stay", "date", "tags", "nested"],
};

describe("送給供應商的 schema", () => {
  it("移除數值、長度、數量與 pattern 限制，保留型別、列舉與 required；限制改由 Zod 驗證（S-02）", () => {
    const out = JSON.stringify(toProviderSchema(schema, "anthropic"));
    expect(out).not.toMatch(/minLength|maxLength|minimum|maximum|maxItems|"minItems":1|pattern|\$schema/);
    expect(out).toContain('"enum":["a","b"]');
    expect(out).toContain('"required":["name","stay","date","tags","nested"]');
  });

  it("所有物件都設 additionalProperties: false", () => {
    const out = toProviderSchema(schema, "gemini") as { additionalProperties: boolean; properties: Record<string, { additionalProperties?: boolean }> };
    expect(out.additionalProperties).toBe(false);
    expect(out.properties.nested?.additionalProperties).toBe(false);
  });

  it("只保留供應商支援的 format", () => {
    expect(JSON.stringify(toProviderSchema(schema, "gemini"))).not.toContain('"uri"');
    expect(JSON.stringify(toProviderSchema(schema, "anthropic"))).toContain('"uri"');
  });

  it("OpenAI strict：選填欄位改為必填且可為 null", () => {
    const out = toProviderSchema(schema, "openai") as { required: string[]; properties: Record<string, unknown> };
    expect(out.required).toContain("note");
    expect(out.properties.note).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
  });

  it("OpenAI 回傳後移除為選填欄位補上的 null，原本可為 null 的欄位保留", () => {
    const withNullable = {
      ...schema,
      properties: { ...schema.properties, maybe: { type: ["string", "null"] } },
      required: [...schema.required, "maybe"],
    };
    const value = { name: "x", stay: 30, date: "2026-12-01", note: null, tags: ["a"], nested: { url: "https://a" }, maybe: null };
    expect(stripInjectedNulls(value, withNullable)).toEqual({
      name: "x",
      stay: 30,
      date: "2026-12-01",
      tags: ["a"],
      nested: { url: "https://a" },
      maybe: null,
    });
  });

  it("不支援的組合關鍵字原樣拒絕", () => {
    expect(() => toProviderSchema({ oneOf: [{ type: "string" }] }, "anthropic")).toThrow(/oneOf/);
    expect(() => toProviderSchema({ not: { type: "string" } }, "openai")).toThrow(/not/);
  });
});

describe("從文字取出 JSON", () => {
  it.each([
    ['{"a":1}', { a: 1 }],
    ['```json\n{"a":1}\n```', { a: 1 }],
    ['結果如下：\n```\n{"a":[1,2]}\n```', { a: [1, 2] }],
  ])("%j", (text, expected) => {
    expect(extractJson(text)).toEqual(expected);
  });

  it("不是 JSON 時回傳 undefined", () => {
    expect(extractJson("沒有資料")).toBeUndefined();
    expect(extractJson("{broken")).toBeUndefined();
  });
});

describe("預設註冊", () => {
  it("三家 provider 都通過註冊表的契約檢查", () => {
    expect(defaultProviders().list().map((p) => p.id)).toEqual(["anthropic", "gemini", "openai"]);
  });

  it("三家 AI key 都有儲存前測試呼叫", () => {
    expect(defaultKeyTesters().map((t) => t.provider)).toEqual(["anthropic", "google_ai", "openai"]);
  });
});
