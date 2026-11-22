// C-11：Route Handlers 與 Server Actions 共用的 Origin 驗證、登入檢查、每位使用者每個端點的速率限制

export interface GuardUser {
  id: string;
}

export interface GuardOptions {
  endpoint: string;
  limit: number;
  windowSeconds: number;
  allowedOrigins: readonly string[];
  getUser: () => Promise<GuardUser | null>;
  checkRateLimit: (endpoint: string, limit: number, windowSeconds: number) => Promise<boolean>;
}

export type GuardResult = { ok: true; user: GuardUser } | { ok: false; response: Response };

const SAFE_METHODS = new Set(["GET", "HEAD"]);

export function isAllowedOrigin(request: Request, allowedOrigins: readonly string[]): boolean {
  const origin = request.headers.get("origin");
  if (origin) return allowedOrigins.includes(origin);
  // 瀏覽器對同源 GET 可能不送 Origin，改以 Sec-Fetch-Site 判斷；寫入請求一律要求 Origin
  if (!SAFE_METHODS.has(request.method.toUpperCase())) return false;
  const site = request.headers.get("sec-fetch-site");
  return site === "same-origin" || site === "none";
}

function deny(status: number, message: string, headers: Record<string, string> = {}): GuardResult {
  return {
    ok: false,
    response: Response.json({ error: message }, { status, headers }),
  };
}

export async function guardRequest(request: Request, options: GuardOptions): Promise<GuardResult> {
  if (!isAllowedOrigin(request, options.allowedOrigins)) return deny(403, "來源不符");

  const user = await options.getUser();
  if (!user) return deny(401, "需要登入");

  const allowed = await options.checkRateLimit(options.endpoint, options.limit, options.windowSeconds);
  if (!allowed) {
    return deny(429, "請求過於頻繁，請稍後再試", { "retry-after": String(options.windowSeconds) });
  }

  return { ok: true, user };
}
