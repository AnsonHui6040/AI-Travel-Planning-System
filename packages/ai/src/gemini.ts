import { GoogleGenAI } from "@google/genai";
import type { Credential, KeyTester, ProviderAdapter, ProviderRequest, ProviderResponse } from "@atps/core";
import { ProviderError, classifyProviderError, keyTestFailure, toProviderError } from "./errors";
import { extractJson, toProviderSchema } from "./schema";
import { KEY_TEST_TIMEOUT_MS, citations, requireApiKey, settings, useSearch, type ProviderOptions } from "./shared";

// T13：Google Gemini（generateContent，官方 SDK）。結構化輸出以 responseJsonSchema 指定；
// 與 Google 搜尋並用需 Gemini 3 以上的模型（T14 選擇模型時確認）。
const ID = "gemini";

function client(
  options: ProviderOptions,
  apiKey: string,
  fetch: typeof globalThis.fetch,
  overrides: { timeoutMs?: number; attempts?: number } = {},
) {
  const s = settings(options);
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: overrides.timeoutMs ?? s.timeoutMs,
      retryOptions: { attempts: overrides.attempts ?? s.maxRetries + 1, initialDelay: 1, maxDelay: 30 },
      fetch,
    },
  });
}

// SDK 逾時只拋 AbortError。每次嘗試有自己的 signal，adapter 不傳入取消用的 signal，
// 所以最後一次嘗試的 signal 已中止即代表逾時。不比較時鐘：timer 可能比 Date.now() 早觸發。
// 注入 fetch 後 SDK 不再停用 Undici 的 300 秒逾時；它超過本專案的逾時設定，且同樣分類為逾時。
async function withTimeoutKind<T>(
  options: ProviderOptions,
  run: (fetch: typeof globalThis.fetch) => Promise<T>,
): Promise<T> {
  let signal: AbortSignal | null | undefined;
  const fetch: typeof globalThis.fetch = (input, init) => {
    signal = init?.signal;
    return options.fetch ? options.fetch(input, init) : globalThis.fetch(input, init);
  };
  try {
    return await run(fetch);
  } catch (error) {
    if (signal?.aborted && classifyProviderError(error) === "interrupted") throw new ProviderError("timeout", ID);
    throw error;
  }
}

export function createGeminiAdapter(options: ProviderOptions = {}): ProviderAdapter {
  const s = settings(options);

  async function generate(request: ProviderRequest, credential: Credential): Promise<ProviderResponse> {
    const apiKey = requireApiKey(ID, credential);
    const search = useSearch(ID, request);
    const schema = toProviderSchema(request.outputSchema, "gemini");

    try {
      const response = await withTimeoutKind(options, (fetch) =>
        client(options, apiKey, fetch).models.generateContent({
          model: request.model,
          contents: request.input,
          config: {
            systemInstruction: request.system,
            maxOutputTokens: request.maxTokens,
            responseMimeType: "application/json",
            responseJsonSchema: schema,
            ...(search ? { tools: [{ googleSearch: {} }] } : {}),
          },
        }),
      );

      const candidate = response.candidates?.[0];
      if (!candidate || candidate.finishReason !== "STOP") throw new ProviderError("unknown", ID);
      const output = extractJson(response.text ?? "");
      if (output === undefined) throw new ProviderError("unknown", ID);

      const urls = (candidate.groundingMetadata?.groundingChunks ?? []).map((chunk) => chunk.web?.uri);
      return {
        output,
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        },
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

// 決策 0006：列出可產生內容的模型，去掉 models/ 前綴
export async function listGeminiModels(apiKey: string, options: ProviderOptions = {}): Promise<string[]> {
  const timeoutMs = options.timeoutMs ?? KEY_TEST_TIMEOUT_MS;
  try {
    return await withTimeoutKind(options, async (fetch) => {
      const ids: string[] = [];
      const pager = await client(options, apiKey, fetch, { timeoutMs }).models.list({ config: { pageSize: 100 } });
      for await (const model of pager) {
        if (model.name && (model.supportedActions ?? []).includes("generateContent")) {
          ids.push(model.name.replace(/^models\//, ""));
        }
        if (ids.length >= MAX_MODELS) break;
      }
      return ids;
    });
  } catch (error) {
    throw toProviderError(ID, error);
  }
}

// C-03：列出模型（不消耗 token）確認 key 可用
export function createGeminiKeyTester(options: ProviderOptions = {}): KeyTester {
  return {
    provider: "google_ai",
    async test(secret) {
      const timeoutMs = options.timeoutMs ?? KEY_TEST_TIMEOUT_MS;
      try {
        await withTimeoutKind(options, (fetch) =>
          client(options, secret, fetch, { timeoutMs, attempts: 1 }).models.list({ config: { pageSize: 1 } }),
        );
        return { ok: true };
      } catch (error) {
        return keyTestFailure(error);
      }
    },
  };
}
