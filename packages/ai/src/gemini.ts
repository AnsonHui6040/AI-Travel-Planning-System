import { GoogleGenAI } from "@google/genai";
import type { Credential, KeyTester, ProviderAdapter, ProviderRequest, ProviderResponse } from "@atps/core";
import { ProviderError, classifyProviderError, keyTestFailure, toProviderError } from "./errors";
import { extractJson, toProviderSchema } from "./schema";
import { KEY_TEST_TIMEOUT_MS, citations, requireApiKey, settings, useSearch, type ProviderOptions } from "./shared";

// T13：Google Gemini（generateContent，官方 SDK）。結構化輸出以 responseJsonSchema 指定；
// 與 Google 搜尋並用需 Gemini 3 以上的模型（T14 選擇模型時確認）。
const ID = "gemini";

function client(options: ProviderOptions, apiKey: string, overrides: { timeoutMs?: number; attempts?: number } = {}) {
  const s = settings(options);
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: overrides.timeoutMs ?? s.timeoutMs,
      retryOptions: { attempts: overrides.attempts ?? s.maxRetries + 1, initialDelay: 1, maxDelay: 30 },
      ...(s.fetch ? { fetch: s.fetch } : {}),
    },
  });
}

// SDK 逾時以 AbortError 呈現；以計時判斷是否為逾時
async function withTimeoutKind<T>(timeoutMs: number, run: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await run();
  } catch (error) {
    if (classifyProviderError(error) === "interrupted" && Date.now() - started >= timeoutMs) {
      throw new ProviderError("timeout", ID);
    }
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
      const response = await withTimeoutKind(s.timeoutMs, () =>
        client(options, apiKey).models.generateContent({
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

// C-03：列出模型（不消耗 token）確認 key 可用
export function createGeminiKeyTester(options: ProviderOptions = {}): KeyTester {
  return {
    provider: "google_ai",
    async test(secret) {
      const timeoutMs = options.timeoutMs ?? KEY_TEST_TIMEOUT_MS;
      try {
        await withTimeoutKind(timeoutMs, () =>
          client(options, secret, { timeoutMs, attempts: 1 }).models.list({ config: { pageSize: 1 } }),
        );
        return { ok: true };
      } catch (error) {
        return keyTestFailure(error);
      }
    },
  };
}
