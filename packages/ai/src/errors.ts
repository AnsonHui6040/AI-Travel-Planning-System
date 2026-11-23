import type { KeyTestResult, ProviderErrorClass } from "@atps/core";

// T13：供應商錯誤分類（逾時、限流、中斷、驗證失敗、其他）。
// 對外只拋 ProviderError：訊息固定，不帶出供應商回應、請求內容或 key（C-04）。

const MESSAGES: Record<ProviderErrorClass, string> = {
  timeout: "AI 供應商回應逾時",
  rate_limit: "AI 供應商暫時限流",
  interrupted: "AI 供應商連線中斷或暫時無法使用",
  auth: "AI 供應商驗證失敗",
  unknown: "AI 供應商回應無法使用",
};

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorClass,
    readonly provider: string,
    readonly status?: number,
  ) {
    super(MESSAGES[kind]);
    this.name = "ProviderError";
  }
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function nameChain(error: unknown): string {
  const names: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth++) {
    const { name, constructor, message } = current as { name?: unknown; constructor?: { name?: string }; message?: unknown };
    names.push(String(name ?? ""), String(constructor?.name ?? ""), typeof message === "string" ? message : "");
    current = (current as { cause?: unknown }).cause;
  }
  return names.join(" ");
}

// 依 HTTP 狀態碼與錯誤型別分類；任何輸入都回傳已定義類別，不拋出錯誤
export function classifyProviderError(error: unknown): ProviderErrorClass {
  try {
    if (error instanceof ProviderError) return error.kind;
    const status = statusOf(error);
    const names = nameChain(error);
    if (status === 408 || status === 504 || /Timeout|TimeoutError|timed out/i.test(names)) return "timeout";
    if (status === 401 || status === 403) return "auth";
    if (status === 429) return "rate_limit";
    if (status !== undefined && status >= 500) return "interrupted";
    if (status === undefined && /Connection|fetch failed|ECONNRESET|ENOTFOUND|socket|network|Abort/i.test(names)) {
      return "interrupted";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function toProviderError(provider: string, error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  return new ProviderError(classifyProviderError(error), provider, statusOf(error));
}

// 儲存前測試呼叫的結果（C-03）。原因固定，不含 key
export function keyTestFailure(error: unknown): KeyTestResult {
  switch (classifyProviderError(error)) {
    case "auth":
      return { ok: false, reason: "API key 無效或沒有權限" };
    case "rate_limit":
      return { ok: false, reason: "供應商暫時限流，請稍後再試" };
    case "timeout":
    case "interrupted":
      return { ok: false, reason: "無法連線到供應商，請稍後再試" };
    default:
      return { ok: false, reason: "測試呼叫失敗，請確認 key 是否正確" };
  }
}
