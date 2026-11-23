import Anthropic from "@anthropic-ai/sdk";
import type { Credential, KeyTester, ProviderAdapter, ProviderRequest, ProviderResponse } from "@atps/core";
import { ProviderError, classifyProviderError, keyTestFailure, toProviderError } from "./errors";
import { extractJson, toProviderSchema } from "./schema";
import {
  KEY_TEST_TIMEOUT_MS,
  citations,
  jsonInstruction,
  requireApiKey,
  settings,
  useSearch,
  type ProviderOptions,
} from "./shared";

// T13：Anthropic Claude（Messages API，官方 SDK）。
// 沒有搜尋時以 output_config.format 取得 JSON；搜尋時引用一律開啟，而引用與結構化輸出不能並用，
// 因此改以系統提示要求最後輸出 JSON，再由文字取出。兩者回傳後都以角色的 Zod schema 驗證（S-02）。
const ID = "anthropic";
// 搜尋時 pause_turn 的續傳上限
const MAX_CONTINUATIONS = 3;

function client(options: ProviderOptions, apiKey: string, overrides: { timeoutMs?: number; maxRetries?: number } = {}) {
  const s = settings(options);
  return new Anthropic({
    apiKey,
    timeout: overrides.timeoutMs ?? s.timeoutMs,
    maxRetries: overrides.maxRetries ?? s.maxRetries,
    ...(s.fetch ? { fetch: s.fetch } : {}),
  });
}

export function createAnthropicAdapter(options: ProviderOptions = {}): ProviderAdapter {
  const s = settings(options);

  async function generate(request: ProviderRequest, credential: Credential): Promise<ProviderResponse> {
    const apiKey = requireApiKey(ID, credential);
    const search = useSearch(ID, request);
    const schema = toProviderSchema(request.outputSchema, "anthropic");
    const api = client(options, apiKey);

    try {
      const messages: Anthropic.MessageParam[] = [{ role: "user", content: request.input }];
      const content: Anthropic.ContentBlock[] = [];
      let inputTokens = 0;
      let outputTokens = 0;

      for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
        const response = await api.messages.create({
          model: request.model,
          max_tokens: request.maxTokens,
          system: search ? `${request.system}\n\n${jsonInstruction(schema)}` : request.system,
          messages,
          ...(search
            ? { tools: [{ type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 5 }] }
            : { output_config: { format: { type: "json_schema" as const, schema } } }),
        });
        inputTokens += response.usage.input_tokens;
        outputTokens += response.usage.output_tokens;
        content.push(...response.content);
        if (response.stop_reason !== "pause_turn") {
          if (response.stop_reason !== "end_turn") throw new ProviderError("unknown", ID);
          break;
        }
        if (turn === MAX_CONTINUATIONS) throw new ProviderError("unknown", ID);
        messages.push({ role: "assistant", content: response.content });
      }

      const texts = content.filter((b): b is Anthropic.TextBlock => b.type === "text");
      const finalText = texts.at(-1)?.text ?? "";
      const output = search ? extractJson(finalText) : extractJson(texts.map((t) => t.text).join(""));
      if (output === undefined) throw new ProviderError("unknown", ID);

      const urls = texts.flatMap((t) =>
        (t.citations ?? []).map((c) => (c.type === "web_search_result_location" ? c.url : undefined)),
      );
      return {
        output,
        usage: { inputTokens, outputTokens },
        citations: citations(urls, s.now()),
      };
    } catch (error) {
      throw toProviderError(ID, error);
    }
  }

  return {
    id: ID,
    authMethods: ["api_key"],
    builtInSearch: true,
    generate,
    classifyError: classifyProviderError,
  };
}

const MAX_MODELS = 200;

// 決策 0006：列出可用模型供設定頁選擇
export async function listAnthropicModels(apiKey: string, options: ProviderOptions = {}): Promise<string[]> {
  try {
    const ids: string[] = [];
    for await (const model of client(options, apiKey, { timeoutMs: options.timeoutMs ?? KEY_TEST_TIMEOUT_MS }).models.list({
      limit: 100,
    })) {
      ids.push(model.id);
      if (ids.length >= MAX_MODELS) break;
    }
    return ids;
  } catch (error) {
    throw toProviderError(ID, error);
  }
}

// C-03：列出模型（不消耗 token）確認 key 可用
export function createAnthropicKeyTester(options: ProviderOptions = {}): KeyTester {
  return {
    provider: "anthropic",
    async test(secret) {
      try {
        await client(options, secret, { timeoutMs: options.timeoutMs ?? KEY_TEST_TIMEOUT_MS, maxRetries: 0 }).models.list({
          limit: 1,
        });
        return { ok: true };
      } catch (error) {
        return keyTestFailure(error);
      }
    },
  };
}
