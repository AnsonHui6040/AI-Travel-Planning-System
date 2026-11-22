// S-08：CSP、HSTS、frame-ancestors。
// CSP 帶每次請求不同的 nonce，由 proxy.ts 產生；HSTS 由 next.config.ts 套用到所有路徑。

const NONCE_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const NONCE_BYTES = 16;

export const STRICT_TRANSPORT_SECURITY = "max-age=63072000; includeSubDomains";

export const staticSecurityHeaders: ReadonlyArray<{ key: string; value: string }> = [
  { key: "Strict-Transport-Security", value: STRICT_TRANSPORT_SECURITY },
];

export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  return btoa(String.fromCharCode(...bytes));
}

export function buildContentSecurityPolicy({
  nonce,
  isDev,
}: {
  nonce: string;
  isDev: boolean;
}): string {
  if (!NONCE_PATTERN.test(nonce)) throw new Error("nonce 必須是 base64 字串");

  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  // React 在 development 以 eval 重建伺服器端錯誤堆疊；production 不需要
  if (isDev) scriptSrc.push("'unsafe-eval'");

  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", scriptSrc],
    ["style-src", ["'self'", `'nonce-${nonce}'`]],
    ["img-src", ["'self'", "blob:", "data:"]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];

  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}
