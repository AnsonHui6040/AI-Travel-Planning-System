// T13：把角色的 JSON Schema 轉成各供應商結構化輸出接受的子集。
// 數值、長度、數量與 pattern 等限制在此移除，回傳後一律以原 Zod schema 嚴格驗證（S-02）。

export type SchemaDialect = "anthropic" | "gemini" | "openai";
type Json = Record<string, unknown>;

const KEEP = new Set([
  "type",
  "properties",
  "required",
  "items",
  "enum",
  "const",
  "anyOf",
  "$ref",
  "$defs",
  "definitions",
  "description",
  "title",
  "format",
]);

const REJECT = ["oneOf", "not", "if", "then", "else", "patternProperties", "dependentSchemas"];

const FORMATS: Record<SchemaDialect, readonly string[]> = {
  anthropic: ["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"],
  gemini: ["date-time", "date", "time"],
  openai: ["date-time", "time", "date", "duration", "email", "hostname", "ipv4", "ipv6", "uuid"],
};

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

function isObjectSchema(node: Json): boolean {
  return node.type === "object" || (Array.isArray(node.type) && node.type.includes("object")) || isObject(node.properties);
}

function allowsNull(node: unknown): boolean {
  if (!isObject(node)) return false;
  if (node.type === "null" || (Array.isArray(node.type) && node.type.includes("null"))) return true;
  return Array.isArray(node.anyOf) && node.anyOf.some(allowsNull);
}

function convert(node: unknown, dialect: SchemaDialect): unknown {
  if (Array.isArray(node)) return node.map((n) => convert(n, dialect));
  if (!isObject(node)) return node;

  for (const keyword of REJECT) {
    if (keyword in node) throw new Error(`結構化輸出不支援 ${keyword}`);
  }

  const out: Json = {};
  for (const [key, value] of Object.entries(node)) {
    if (!KEEP.has(key)) continue;
    if (key === "format" && !(typeof value === "string" && FORMATS[dialect].includes(value))) continue;
    if (key === "properties" && isObject(value)) {
      out.properties = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, convert(v, dialect)]));
    } else if (key === "$defs" || key === "definitions") {
      out[key] = isObject(value)
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, convert(v, dialect)]))
        : value;
    } else if (key === "items" || key === "anyOf") {
      out[key] = convert(value, dialect);
    } else {
      out[key] = value;
    }
  }

  if (isObjectSchema(node)) {
    out.additionalProperties = false;
    if (dialect === "openai" && isObject(out.properties)) {
      // OpenAI strict：所有欄位必填；原本選填的欄位改為可為 null，回傳後由 stripInjectedNulls 移除
      const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
      const properties = out.properties as Json;
      for (const [name, property] of Object.entries(properties)) {
        if (!required.has(name) && !allowsNull(property)) {
          properties[name] = { anyOf: [property, { type: "null" }] };
        }
      }
      out.required = Object.keys(properties);
    }
  }
  return out;
}

export function toProviderSchema(schema: Record<string, unknown>, dialect: SchemaDialect): Record<string, unknown> {
  return convert(schema, dialect) as Record<string, unknown>;
}

// OpenAI 回傳後，移除為原本選填欄位補上的 null；原本就允許 null 的欄位保留
export function stripInjectedNulls(value: unknown, schema: unknown): unknown {
  if (Array.isArray(value)) {
    const items = isObject(schema) ? schema.items : undefined;
    return value.map((v) => stripInjectedNulls(v, items));
  }
  if (!isObject(value) || !isObject(schema) || !isObject(schema.properties)) return value;
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const properties = schema.properties;
  const out: Json = {};
  for (const [key, v] of Object.entries(value)) {
    const property = properties[key];
    if (v === null && !required.has(key) && !allowsNull(property)) continue;
    out[key] = stripInjectedNulls(v, property);
  }
  return out;
}

// 由模型回覆的文字取出 JSON：允許前後說明文字與 ``` 區塊；取不到時回傳 undefined
export function extractJson(text: string): unknown {
  // 優先順序：最後一個 ``` 區塊、整段文字、第一個 { 或 [ 到最後一個 } 或 ]
  const fences: string[] = [];
  for (const match of text.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n?```/g)) if (match[1]) fences.push(match[1]);
  const candidates = [...fences.reverse(), text.trim()];
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // 試下一個候選
    }
  }
  return undefined;
}
