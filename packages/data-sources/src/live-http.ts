// T22：即時資料 adapter 共用的 HTTP 讀取。只連到各 adapter 固定的官方 API 端點（不接受外部提供的網址），
// 不跟隨 redirect，限制時間與回應大小。錯誤訊息只含 HTTP 狀態，不含網址（ODPT 的 key 在查詢參數）。

export interface LiveFetchOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  now?: () => Date;
}

export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class LiveDataError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function createJsonGetter(service: string, options: LiveFetchOptions) {
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  return async (url: URL): Promise<unknown> => {
    let response: Response;
    try {
      response = await doFetch(url, { method: "GET", headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
    } catch {
      throw new LiveDataError(`無法連線 ${service}`, null);
    }
    if (!response.ok) {
      if (response.status === 429) throw new LiveDataError(`${service} 請求過於頻繁（429）`, 429);
      throw new LiveDataError(`${service} 請求失敗（${response.status}）`, response.status);
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_RESPONSE_BYTES) throw new LiveDataError(`${service} 回應過大`, response.status);
    let body: string;
    try {
      body = await response.text();
    } catch {
      throw new LiveDataError(`無法讀取 ${service} 的回應`, response.status);
    }
    if (body.length > MAX_RESPONSE_BYTES) throw new LiveDataError(`${service} 回應過大`, response.status);
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new LiveDataError(`${service} 回應格式不正確`, response.status);
    }
  };
}
