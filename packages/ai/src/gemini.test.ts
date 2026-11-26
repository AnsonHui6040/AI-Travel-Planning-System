import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGeminiAdapter, listGeminiModels } from "./gemini";
import { fakeFetch } from "./testing/fake-fetch";
import { geminiFixtures } from "./testing/fixtures";

// T13、C-07：Gemini SDK 逾時只拋 AbortError，分類由 adapter 判斷
const KEY = "test-only-key-value-0001";
const credential = { kind: "api_key" as const, secret: KEY };
const request = {
  model: "fixture-model",
  system: "你是研究員。",
  input: "列出淺草附近的景點。",
  outputSchema: { type: "object", properties: { ok: { type: "boolean" } } },
  tools: [],
  maxTokens: 2000,
};

// 回應標頭已送達、內容一直沒有送完；中止時與原生 fetch 一樣讓內容串流失敗
const stalledBody: typeof globalThis.fetch = async (_input, init) =>
  new Response(
    new ReadableStream({
      start(controller) {
        init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

describe("Gemini adapter 的逾時分類（C-07）", () => {
  describe("系統時鐘落後於逾時計時器", () => {
    beforeEach(() => {
      vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-23T09:00:00Z"));
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("回應內容讀到一半逾時，分類為逾時", async () => {
      const adapter = createGeminiAdapter({ fetch: stalledBody, maxRetries: 0, timeoutMs: 50 });
      await expect(adapter.generate(request, credential)).rejects.toMatchObject({ kind: "timeout" });
    });

    it("列出模型逾時，分類為逾時", async () => {
      const { fetch } = fakeFetch(["hang"]);
      await expect(listGeminiModels(KEY, { fetch, maxRetries: 0, timeoutMs: 50 })).rejects.toMatchObject({
        kind: "timeout",
      });
    });
  });

  it("逾時後重試遇到連線中斷，依最後一次嘗試分類為中斷", async () => {
    const { fetch, remaining } = fakeFetch(["hang", "network-error"]);
    const adapter = createGeminiAdapter({ fetch, maxRetries: 1, timeoutMs: 50 });
    await expect(adapter.generate(request, credential)).rejects.toMatchObject({ kind: "interrupted" });
    expect(remaining()).toBe(0);
  }, 10_000);

  it("未注入 fetch 時使用呼叫當下的全域 fetch", async () => {
    const { fetch, requests } = fakeFetch([geminiFixtures.models]);
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(listGeminiModels(KEY, { maxRetries: 0 })).resolves.toEqual([]);
      expect(requests).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
