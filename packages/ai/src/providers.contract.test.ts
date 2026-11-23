import { checkProviderAdapter, type KeyTester, type ProviderAdapter, type ProviderRequest } from "@atps/core";
import { describe, expect, it } from "vitest";
import {
  ProviderError,
  createAnthropicAdapter,
  createAnthropicKeyTester,
  createGeminiAdapter,
  createGeminiKeyTester,
  createOpenAIAdapter,
  createOpenAIKeyTester,
  type ProviderOptions,
} from "./index";
import { fakeFetch, type Step } from "./testing/fake-fetch";
import { CITED, SAMPLE_OUTPUT, anthropicFixtures, geminiFixtures, openaiFixtures } from "./testing/fixtures";

// T13：三家 provider adapter 共用契約測試（錄製回應）。新增 provider 時加入下方清單即可。
const KEY = "test-only-key-value-0001";
const NOW = new Date("2026-11-23T09:00:00Z");

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        properties: { name: { type: "string", minLength: 1, maxLength: 100 }, reason: { type: "string" } },
        required: ["name", "reason"],
      },
    },
  },
  required: ["candidates"],
};

const request = (overrides: Partial<ProviderRequest> = {}): ProviderRequest => ({
  model: "fixture-model",
  system: "你是研究員。",
  input: "列出淺草附近的景點。",
  outputSchema: OUTPUT_SCHEMA,
  tools: [],
  maxTokens: 2000,
  ...overrides,
});

interface Fixtures {
  structured: Step;
  search: Step;
  refusal: Step;
  models: Step;
  error: (status: number, type: string) => Step;
}

interface Case {
  name: string;
  keyProvider: KeyTester["provider"];
  fixtures: Fixtures;
  create: (options: ProviderOptions) => ProviderAdapter;
  tester: (options: ProviderOptions) => KeyTester;
  host: string;
  // 認證標頭名稱與取值方式
  authHeader: (headers: Record<string, string>, url: string) => string | undefined;
  overloaded: Step;
  searchToolInBody: (body: unknown) => boolean;
  schemaInBody: (body: unknown) => unknown;
}

const anyBody = (body: unknown) => body as Record<string, unknown>;

const CASES: Case[] = [
  {
    name: "anthropic",
    keyProvider: "anthropic",
    fixtures: anthropicFixtures,
    create: createAnthropicAdapter,
    tester: createAnthropicKeyTester,
    host: "api.anthropic.com",
    // SDK 1.x 以 Authorization: Bearer 傳送 API key
    authHeader: (h) => h["x-api-key"] ?? h.authorization?.replace(/^Bearer /, ""),
    overloaded: anthropicFixtures.error(529, "overloaded_error"),
    searchToolInBody: (b) =>
      ((anyBody(b).tools as { type: string }[] | undefined) ?? []).some((t) => t.type.startsWith("web_search")),
    schemaInBody: (b) => (anyBody(b).output_config as { format?: { schema: unknown } } | undefined)?.format?.schema,
  },
  {
    name: "gemini",
    keyProvider: "google_ai",
    fixtures: geminiFixtures,
    create: createGeminiAdapter,
    tester: createGeminiKeyTester,
    host: "generativelanguage.googleapis.com",
    authHeader: (h) => h["x-goog-api-key"],
    overloaded: geminiFixtures.error(503, "UNAVAILABLE"),
    searchToolInBody: (b) =>
      ((anyBody(b).tools as Record<string, unknown>[] | undefined) ?? []).some((t) => "googleSearch" in t),
    schemaInBody: (b) =>
      (anyBody(b).generationConfig as { responseJsonSchema?: unknown } | undefined)?.responseJsonSchema,
  },
  {
    name: "openai",
    keyProvider: "openai",
    fixtures: openaiFixtures,
    create: createOpenAIAdapter,
    tester: createOpenAIKeyTester,
    host: "api.openai.com",
    authHeader: (h) => h.authorization?.replace(/^Bearer /, ""),
    overloaded: openaiFixtures.error(503, "server_error"),
    searchToolInBody: (b) =>
      ((anyBody(b).tools as { type: string }[] | undefined) ?? []).some((t) => t.type.startsWith("web_search")),
    schemaInBody: (b) =>
      (anyBody(b).text as { format?: { schema: unknown } } | undefined)?.format?.schema,
  },
];

const credential = { kind: "api_key" as const, secret: KEY };

async function failure(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(
    () => {
      throw new Error("預期失敗");
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

describe.each(CASES)("ProviderAdapter 共用契約：$name", (c) => {
  const options = (steps: Step[], extra: Partial<ProviderOptions> = {}) => {
    const fake = fakeFetch(steps);
    return { fake, opts: { fetch: fake.fetch, maxRetries: 0, timeoutMs: 5_000, now: () => NOW, ...extra } };
  };

  it("通過 T11 的 ProviderAdapter 契約檢查", () => {
    expect(checkProviderAdapter(c.create({}))).toEqual([]);
  });

  it("結構化輸出：回傳解析後的 JSON 與 token 用量，請求只走 HTTPS 並帶 key", async () => {
    const { fake, opts } = options([c.fixtures.structured]);
    const response = await c.create(opts).generate(request(), credential);
    expect(response.output).toEqual(SAMPLE_OUTPUT);
    expect(response.usage.inputTokens).toBeGreaterThan(0);
    expect(response.usage.outputTokens).toBeGreaterThan(0);
    expect(response.citations).toEqual([]);

    const sent = fake.requests[0];
    expect(sent).toBeDefined();
    const url = new URL(sent?.url ?? "");
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe(c.host);
    expect(c.authHeader(sent?.headers ?? {}, sent?.url ?? "")).toBe(KEY);
    expect(c.searchToolInBody(sent?.body)).toBe(false);
  });

  it("送出的 schema 已移除供應商不支援的限制，物件不允許額外欄位", async () => {
    const { fake, opts } = options([c.fixtures.structured]);
    await c.create(opts).generate(request(), credential);
    const schema = JSON.stringify(c.schemaInBody(fake.requests[0]?.body));
    expect(schema).toContain('"candidates"');
    expect(schema).not.toMatch(/minLength|maxLength|maxItems/);
    expect(schema).toContain('"additionalProperties":false');
  });

  it("內建搜尋：請求帶搜尋工具，回傳 https 來源與取得時間", async () => {
    const { fake, opts } = options([c.fixtures.search]);
    const response = await c.create(opts).generate(request({ tools: ["provider_search"] }), credential);
    expect(c.searchToolInBody(fake.requests[0]?.body)).toBe(true);
    expect(response.output).toEqual(SAMPLE_OUTPUT);
    expect(response.citations).toEqual([{ url: CITED, retrievedAt: NOW }]);
  });

  it("不支援的工具在送出前拒絕（S-04）", async () => {
    const { fake, opts } = options([]);
    const error = await failure(c.create(opts).generate(request({ tools: ["allowlisted_fetch"] }), credential));
    expect(error.kind).toBe("unknown");
    expect(fake.requests).toHaveLength(0);
  });

  it("拒答或輸出不是 JSON 時拋出，不回傳內容", async () => {
    const { opts } = options([c.fixtures.refusal]);
    const error = await failure(c.create(opts).generate(request(), credential));
    expect(error.kind).toBe("unknown");
    expect(error.message).not.toContain("help");
  });

  it.each([
    [401, "authentication_error", "auth"],
    [403, "permission_error", "auth"],
    [429, "rate_limit_error", "rate_limit"],
    [500, "api_error", "interrupted"],
    [400, "invalid_request_error", "unknown"],
  ] as const)("HTTP %i 分類為 %s → %s", async (status, type, kind) => {
    const { opts } = options([c.fixtures.error(status, type)]);
    const adapter = c.create(opts);
    const error = await failure(adapter.generate(request(), credential));
    expect(error.kind).toBe(kind);
    expect(adapter.classifyError(error)).toBe(kind);
  });

  it("供應商過載分類為中斷", async () => {
    const { opts } = options([c.overloaded]);
    expect((await failure(c.create(opts).generate(request(), credential))).kind).toBe("interrupted");
  });

  it("連線中斷分類為中斷", async () => {
    const { opts } = options(["network-error"]);
    expect((await failure(c.create(opts).generate(request(), credential))).kind).toBe("interrupted");
  });

  it("超過逾時分類為逾時（C-07）", async () => {
    const { opts } = options(["hang"], { timeoutMs: 50 });
    expect((await failure(c.create(opts).generate(request(), credential))).kind).toBe("timeout");
  });

  it("限流時以退避重試後成功（C-07）", async () => {
    const { fake, opts } = options([c.fixtures.error(429, "rate_limit_error"), c.fixtures.structured], {
      maxRetries: 2,
    });
    const response = await c.create(opts).generate(request(), credential);
    expect(response.output).toEqual(SAMPLE_OUTPUT);
    expect(fake.requests).toHaveLength(2);
  });

  it("錯誤訊息與錯誤物件不含 key（C-04）", async () => {
    const { opts } = options([c.fixtures.error(401, "authentication_error")]);
    const error = await failure(c.create(opts).generate(request(), credential));
    expect(error.message).not.toContain(KEY);
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(String(error.stack)).not.toContain(KEY);
  });

  it("classifyError 對任何輸入都回傳已定義類別", () => {
    const adapter = c.create({});
    for (const input of [new Error("x"), null, undefined, "s", { status: 429 }]) {
      expect(["timeout", "rate_limit", "interrupted", "auth", "unknown"]).toContain(adapter.classifyError(input));
    }
  });

  describe("儲存前測試呼叫（C-03）", () => {
    it("列出模型成功時通過，不消耗 token", async () => {
      const { fake, opts } = options([c.fixtures.models]);
      const tester = c.tester(opts);
      expect(tester.provider).toBe(c.keyProvider);
      await expect(tester.test(KEY)).resolves.toEqual({ ok: true });
      expect(fake.requests[0]?.method).toBe("GET");
      expect(fake.requests[0]?.url).toContain("models");
    });

    it("key 無效時失敗，原因不含 key", async () => {
      const { opts } = options([c.fixtures.error(401, "authentication_error")]);
      const result = await c.tester(opts).test(KEY);
      expect(result).toEqual({ ok: false, reason: "API key 無效或沒有權限" });
    });

    it("限流或連線問題時失敗，提示稍後再試", async () => {
      const limited = await c.tester(options([c.fixtures.error(429, "rate_limit_error")]).opts).test(KEY);
      expect(limited).toEqual({ ok: false, reason: "供應商暫時限流，請稍後再試" });
      const offline = await c.tester(options(["network-error"]).opts).test(KEY);
      expect(offline).toEqual({ ok: false, reason: "無法連線到供應商，請稍後再試" });
    });
  });
});
