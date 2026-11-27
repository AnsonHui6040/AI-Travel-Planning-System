import allowlistFile from "./fetch-allowlist.json";
import { isIpLiteral, isPublicAddress } from "./address";
import { nodeResolve, nodeTransport } from "./node-transport";
import type { AllowlistedRequestInit, FetchBlockReason, FetchLimits, FetchResult, FetchTransport, ResolveHost, TransportResponse } from "./fetch-types";

export type { AllowlistedRequestInit, FetchBlockReason, FetchLimits, FetchResult, FetchTransport, ResolveHost, TransportResponse } from "./fetch-types";

// T16、S-05：白名單 fetch。只供伺服器端使用（Verification 讀取官方網頁、資料源 adapter）

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function validateAllowlist(hosts: readonly string[]): readonly string[] {
  const bad = hosts.filter((h) => !HOSTNAME.test(h) || isIpLiteral(h));
  if (bad.length > 0) throw new Error(`白名單項目格式錯誤：${bad.join("、")}`);
  return Object.freeze([...new Set(hosts)]);
}

// 網域白名單只存於 repo 設定檔，經 PR 修改；執行期間不可變更
export const FETCH_ALLOWLIST: readonly string[] = validateAllowlist(allowlistFile.hosts);
// 決策 0010：以使用者本人 key 呼叫的官方 API 主機（例如 Places 文字搜尋）。與讀取官方網頁的白名單分開，
// Verification 依 AI 輸出讀取網頁時不會連到這些主機；adapter 以 createAllowlistedFetch({ allowlist: FETCH_API_HOSTS }) 使用
export const FETCH_API_HOSTS: readonly string[] = validateAllowlist(allowlistFile.apiHosts);

export const DEFAULT_FETCH_LIMITS: FetchLimits = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  timeoutMs: 10_000,
  maxRedirects: 3,
  contentTypes: Object.freeze(["text/html", "text/plain", "application/json", "application/xml", "text/xml", "application/xhtml+xml"]),
});

export interface AllowlistedFetchOptions {
  allowlist?: readonly string[];
  resolve?: ResolveHost;
  transport?: FetchTransport;
  limits?: Partial<FetchLimits>;
}

const REQUEST_HEADERS = Object.freeze({
  accept: "text/html, text/plain, application/json, application/xml;q=0.9",
  // 不接受壓縮：大小上限以實際傳輸位元組計算
  "accept-encoding": "identity",
  "user-agent": "atps-allowlisted-fetch/1",
});

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

// 呼叫端不可指定的標頭：連線、長度與壓縮由這裡決定，cookie 一律不送
const RESERVED_HEADERS = new Set(["host", "cookie", "accept-encoding", "content-length", "connection", "transfer-encoding", "user-agent"]);
const HEADER_NAME = /^[a-z0-9-]{1,64}$/;
export const MAX_REQUEST_BODY_BYTES = 16 * 1024;

type Prepared = { method: "GET" | "POST"; headers: Record<string, string>; body: string | undefined; custom: boolean };

function prepare(init: AllowlistedRequestInit | undefined): Prepared | Blocked {
  const method = init?.method ?? "GET";
  const extra = init?.headers ?? {};
  const body = init?.body;
  for (const [name, value] of Object.entries(extra)) {
    if (!HEADER_NAME.test(name) || RESERVED_HEADERS.has(name) || /[\r\n]/.test(value)) return block("bad_request", `不允許的標頭：${name}`);
  }
  if (body !== undefined) {
    if (method === "GET") return block("bad_request", "GET 不可帶內容");
    if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BODY_BYTES) return block("bad_request", "內容過大");
  }
  const headers: Record<string, string> = { ...REQUEST_HEADERS, ...extra };
  if (body !== undefined) headers["content-length"] = String(new TextEncoder().encode(body).byteLength);
  return { method, headers, body, custom: Object.keys(extra).length > 0 || body !== undefined };
}

type Blocked = Extract<FetchResult, { ok: false }>;
const block = (reason: FetchBlockReason, detail: string, status?: number): Blocked =>
  status === undefined ? { ok: false, reason, detail } : { ok: false, reason, detail, status };

class Timeout extends Error {}

function checkUrl(raw: string | URL, allowlist: ReadonlySet<string>): URL | Blocked {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return block("invalid_url", "網址格式錯誤");
  }
  if (url.protocol !== "https:") return block("not_https", `只允許 https：${url.protocol}`);
  if (url.username !== "" || url.password !== "") return block("credentials", "網址不可含帳號密碼");
  if (url.port !== "" && url.port !== "443") return block("bad_port", `只允許 443 埠：${url.port}`);
  const host = url.hostname.toLowerCase();
  if (isIpLiteral(host)) return block("ip_literal", `不可直接連線 IP：${host}`);
  if (!allowlist.has(host)) return block("not_allowlisted", `不在白名單：${host}`);
  return url;
}

async function resolvePublic(host: string, resolve: ResolveHost): Promise<string | Blocked> {
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return block("dns_failed", `無法解析：${host}`);
  }
  if (addresses.length === 0) return block("dns_failed", `沒有位址：${host}`);
  // 任何一個解析結果不公開就拒絕，避免連線層挑到私有位址
  const blocked = addresses.filter((a) => !isPublicAddress(a));
  if (blocked.length > 0) return block("private_address", `${host} 解析至不允許的位址`);
  return addresses[0] as string;
}

function mediaType(header: string | undefined): string | null {
  const type = header?.split(";")[0]?.trim().toLowerCase();
  return type ? type : null;
}

async function readBody(response: TransportResponse, maxBytes: number): Promise<Uint8Array | Blocked> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      response.cancel();
      return block("too_large", `內容超過 ${maxBytes} 位元組`);
    }
    chunks.push(chunk);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function withDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new Timeout());
    const onAbort = () => reject(new Timeout());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export type AllowlistedFetch = (url: string | URL, init?: AllowlistedRequestInit) => Promise<FetchResult>;

export function createAllowlistedFetch(options: AllowlistedFetchOptions = {}): AllowlistedFetch {
  const allowlist = new Set(options.allowlist ? validateAllowlist(options.allowlist) : FETCH_ALLOWLIST);
  const limits: FetchLimits = { ...DEFAULT_FETCH_LIMITS, ...options.limits };
  const resolve = options.resolve ?? nodeResolve;
  const transport = options.transport ?? nodeTransport;

  return async (input, init) => {
    const request = prepare(init);
    if ("ok" in request) return request;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
    let current: TransportResponse | undefined;
    try {
      let next: string | URL = input;
      for (let hop = 0; ; hop++) {
        // 每次 redirect 都重新檢查網址、白名單與 DNS 位址
        const url = checkUrl(next, allowlist);
        if (!(url instanceof URL)) return url;
        const address = await withDeadline(resolvePublic(url.hostname.toLowerCase(), resolve), controller.signal);
        if (typeof address !== "string") return address;

        current = await withDeadline(
          transport({ url, address, headers: { ...request.headers }, signal: controller.signal, method: request.method, body: request.body }),
          controller.signal,
        );
        const response = current;

        if (REDIRECTS.has(response.status)) {
          response.cancel();
          if (request.custom) return block("redirect_refused", "帶標頭或內容的請求不跟隨 redirect");
          const location = response.headers.location;
          if (!location) return block("http_status", "redirect 沒有目的地", response.status);
          if (hop >= limits.maxRedirects) return block("too_many_redirects", `redirect 超過 ${limits.maxRedirects} 次`);
          try {
            next = new URL(location, url);
          } catch {
            return block("invalid_url", "redirect 目的地格式錯誤");
          }
          continue;
        }
        if (response.status < 200 || response.status > 299) {
          response.cancel();
          return block("http_status", `回應狀態 ${response.status}`, response.status);
        }
        const type = mediaType(response.headers["content-type"]);
        if (!type || !limits.contentTypes.includes(type)) {
          response.cancel();
          return block("bad_content_type", `不允許的內容類型：${type ?? "無"}`);
        }
        const declared = Number(response.headers["content-length"]);
        if (Number.isFinite(declared) && declared > limits.maxBytes) {
          response.cancel();
          return block("too_large", `宣告長度超過 ${limits.maxBytes} 位元組`);
        }
        const body = await withDeadline(readBody(response, limits.maxBytes), controller.signal);
        if (!(body instanceof Uint8Array)) return body;
        return { ok: true, url: url.href, status: response.status, contentType: type, body: new TextDecoder().decode(body) };
      }
    } catch (error) {
      current?.cancel();
      if (error instanceof Timeout) return block("timeout", `超過 ${limits.timeoutMs} 毫秒`);
      return block("network_error", "連線失敗");
    } finally {
      clearTimeout(timer);
    }
  };
}

// 決策 0010：轉為 fetch 介面，讓官方 API 的 adapter（例如 Google Maps）經白名單連線。
// 2xx 回傳內容；其他狀態碼回傳同一狀態碼（不含內容）；被擋下時丟出錯誤
export function allowlistedFetchAsFetch(fetcher: AllowlistedFetch = createAllowlistedFetch()): (url: string, init?: RequestInit) => Promise<Response> {
  return async (url, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "POST") throw new Error("只支援 GET 與 POST");
    if (init?.body !== undefined && init.body !== null && typeof init.body !== "string") throw new Error("內容須為文字");
    const result = await fetcher(url, { method, headers, ...(typeof init?.body === "string" ? { body: init.body } : {}) });
    if (result.ok) return new Response(result.body, { status: result.status, headers: { "content-type": result.contentType } });
    if (result.reason === "http_status" && result.status !== undefined && result.status >= 200 && result.status <= 599) {
      return new Response(null, { status: result.status });
    }
    throw new Error(`白名單 fetch 拒絕：${result.reason}`);
  };
}
