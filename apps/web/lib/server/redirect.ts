// 登入後的導向目標只允許站內路徑。以 URL 解析後比對 origin，
// 避免 `//host`、`/\host` 等被瀏覽器解讀為外部網址的寫法。
export function safeRedirectPath(next: string | null, origin: string): string {
  if (!next || !next.startsWith("/") || next.includes("\\")) return "/";
  let target: URL;
  try {
    target = new URL(next, origin);
  } catch {
    return "/";
  }
  if (target.origin !== origin) return "/";
  return `${target.pathname}${target.search}${target.hash}`;
}
