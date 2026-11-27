// T16：白名單 fetch 的型別（連線層與檢查邏輯共用）

export type FetchBlockReason =
  | "invalid_url"
  | "not_https"
  | "credentials"
  | "bad_port"
  | "ip_literal"
  | "not_allowlisted"
  | "dns_failed"
  | "private_address"
  | "too_many_redirects"
  | "http_status"
  | "bad_content_type"
  | "too_large"
  | "timeout"
  | "network_error"
  // 決策 0010：帶 key 的請求不跟隨 redirect；不允許的標頭或內容
  | "redirect_refused"
  | "bad_request";

export type FetchResult =
  | { ok: true; url: string; status: number; contentType: string; body: string }
  | { ok: false; reason: FetchBlockReason; detail: string; status?: number };

export interface TransportResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  // 中止連線、不再讀取內容
  cancel(): void;
}

// 連線層只連到 address（已驗證的位址），不得自行再次解析主機名稱
export type FetchTransport = (request: {
  url: URL;
  address: string;
  headers: Record<string, string>;
  signal: AbortSignal;
  method: "GET" | "POST";
  body: string | undefined;
}) => Promise<TransportResponse>;

// 決策 0010：官方 API（例如 Places 文字搜尋）需要 POST、JSON 內容與 key 標頭
export interface AllowlistedRequestInit {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

export type ResolveHost = (host: string) => Promise<string[]>;

export interface FetchLimits {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  contentTypes: readonly string[];
}
