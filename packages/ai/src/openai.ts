import OpenAI from "openai";
import type { Credential, KeyTester, ProviderAdapter, ProviderRequest, ProviderResponse } from "@atps/core";
import { ProviderError, classifyProviderError, keyTestFailure, toProviderError } from "./errors";
import { extractJson, stripInjectedNulls, toProviderSchema } from "./schema";
import { KEY_TEST_TIMEOUT_MS, citations, requireApiKey, settings, useSearch, type ProviderOptions } from "./shared";

// T13：OpenAI（Responses API，官方 SDK）。結構化輸出以 text.format json_schema（strict）指定；
// strict 要求所有欄位必填，原本選填的欄位改為可為 null，回傳後移除補上的 null。
const ID = "openai";

function client(options: ProviderOptions, apiKey: string, overrides: { timeoutMs?: number; maxRetries?: number } = {}) {
  const s = settings(options);
  return new OpenAI({
    apiKey,
    timeout: overrides.timeoutMs ?? s.timeoutMs,
    maxRetries: overrides.maxRetries ?? s.maxRetries,
    ...(s.fetch ? { fetch: s.fetch } : {}),
  });
}

export function createOpenAIAdapter(options: ProviderOptions = {}): ProviderAdapter {
  const s = settings(options);

  async function generate(request: ProviderRequest, credential: Credential): Promise<ProviderResponse> {
    const apiKey = requireApiKey(ID, credential);
    const search = useSearch(ID, request);
    const schema = toProviderSchema(request.outputSchema, "openai");

    try {
      const response = await client(options, apiKey).responses.create({
        model: request.model,
        instructions: request.system,
        input: request.input,
        max_output_tokens: request.maxTokens,
        text: { format: { type: "json_schema", name: "output", schema, strict: true } },
        ...(search ? { tools: [{ type: "web_search" as const }] } : {}),
      });
      if (response.status !== "completed") throw new ProviderError("unknown", ID);

      const parts = response.output.flatMap((item) => (item.type === "message" ? item.content : []));
      if (parts.some((part) => part.type === "refusal")) throw new ProviderError("unknown", ID);
      const texts = parts.filter((part) => part.type === "output_text");
      const raw = extractJson(texts.map((t) => t.text).join(""));
      if (raw === undefined) throw new ProviderError("unknown", ID);

      const urls = texts.flatMap((t) => t.annotations.map((a) => (a.type === "url_citation" ? a.url : undefined)));
      return {
        output: stripInjectedNulls(raw, request.outputSchema),
        usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 },
        citations: citations(urls, s.now()),
      };
    } catch (error) {
      throw toProviderError(ID, error);
    }
  }

  return {
    id: ID,
    // plan_oauth（Sign in with ChatGPT）依 C-06 預留，取得核准或自架版本時再加入
    authMethods: ["api_key"],
    builtInSearch: true,
    generate,
    classifyError: classifyProviderError,
  };
}

const MAX_MODELS = 200;

// 決策 0006：列出可用模型供設定頁選擇
export async function listOpenAIModels(apiKey: string, options: ProviderOptions = {}): Promise<string[]> {
  try {
    const ids: string[] = [];
    for await (const model of client(options, apiKey, { timeoutMs: options.timeoutMs ?? KEY_TEST_TIMEOUT_MS }).models.list()) {
      ids.push(model.id);
      if (ids.length >= MAX_MODELS) break;
    }
    return ids;
  } catch (error) {
    throw toProviderError(ID, error);
  }
}

// C-03：列出模型（不消耗 token）確認 key 可用
export function createOpenAIKeyTester(options: ProviderOptions = {}): KeyTester {
  return {
    provider: "openai",
    async test(secret) {
      try {
        await client(options, secret, { timeoutMs: options.timeoutMs ?? KEY_TEST_TIMEOUT_MS, maxRetries: 0 }).models.list();
        return { ok: true };
      } catch (error) {
        return keyTestFailure(error);
      }
    },
  };
}
