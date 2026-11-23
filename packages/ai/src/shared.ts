import type { Credential, ProviderRequest, ProviderResponse } from "@atps/core";
import { ProviderError } from "./errors";

// 三家 adapter 共用的設定與檢查

export interface ProviderOptions {
  // 測試時注入錄製回應；正式環境使用全域 fetch
  fetch?: typeof globalThis.fetch;
  // C-07：每個呼叫設逾時
  timeoutMs?: number;
  // C-07：限流與暫時性錯誤以 SDK 內建的指數退避重試
  maxRetries?: number;
  now?: () => Date;
}

export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_RETRIES = 2;
// 儲存前測試呼叫：不重試，逾時較短
export const KEY_TEST_TIMEOUT_MS = 15_000;

export function settings(options: ProviderOptions) {
  return {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    now: options.now ?? (() => new Date()),
    fetch: options.fetch,
  };
}

// S-04：adapter 只處理供應商內建搜尋；白名單 fetch 與交通狀態由伺服器執行（T17、T22），在送出前拒絕
export function useSearch(provider: string, request: ProviderRequest): boolean {
  const unsupported = request.tools.filter((t) => t !== "provider_search");
  if (unsupported.length > 0) throw new ProviderError("unknown", provider);
  return request.tools.includes("provider_search");
}

export function requireApiKey(provider: string, credential: Credential): string {
  if (credential.kind !== "api_key" || credential.secret.length === 0) throw new ProviderError("auth", provider);
  return credential.secret;
}

// 只保留 https 來源並去除重複（S-03：來源附網址與取得時間）
export function citations(urls: readonly (string | undefined)[], retrievedAt: Date): ProviderResponse["citations"] {
  const seen = new Set<string>();
  const out: ProviderResponse["citations"] = [];
  for (const url of urls) {
    if (!url || seen.has(url)) continue;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:") continue;
    seen.add(url);
    out.push({ url, retrievedAt });
  }
  return out;
}

export function jsonInstruction(schema: Record<string, unknown>): string {
  return `最後只輸出一個符合下列 JSON Schema 的 JSON，不加其他文字：\n${JSON.stringify(schema)}`;
}
