import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  createNonce,
  STRICT_TRANSPORT_SECURITY,
  staticSecurityHeaders,
} from "./security-headers";

function directive(policy: string, name: string): string[] {
  const found = policy
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .find(([key]) => key === name);
  if (!found) throw new Error(`缺少 ${name}`);
  return found.slice(1);
}

describe("S-08 CSP", () => {
  const nonce = "dGVzdG5vbmNldGVzdG5vbmNl";
  const production = buildContentSecurityPolicy({ nonce, isDev: false });

  it("script-src 只允許本站、該次 nonce 與 strict-dynamic，不允許 unsafe-inline", () => {
    const scriptSrc = directive(production, "script-src");
    expect(scriptSrc).toEqual(["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]);
  });

  it("frame-ancestors 禁止任何網站以框架嵌入", () => {
    expect(directive(production, "frame-ancestors")).toEqual(["'none'"]);
  });

  it("禁止 plugin 物件，限制 base 與表單送出目標為本站", () => {
    expect(directive(production, "object-src")).toEqual(["'none'"]);
    expect(directive(production, "base-uri")).toEqual(["'self'"]);
    expect(directive(production, "form-action")).toEqual(["'self'"]);
    expect(directive(production, "default-src")).toEqual(["'self'"]);
  });

  it("production 不允許 unsafe-eval，development 才允許", () => {
    expect(production).not.toContain("'unsafe-eval'");
    const dev = buildContentSecurityPolicy({ nonce, isDev: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
  });

  it("拒絕不是 base64 的 nonce，避免注入其他指令", () => {
    expect(() => buildContentSecurityPolicy({ nonce: "abc'; script-src *", isDev: false })).toThrow();
  });
});

describe("nonce", () => {
  it("每次產生不同的值，至少 128 bit", () => {
    const values = new Set(Array.from({ length: 50 }, () => createNonce()));
    expect(values.size).toBe(50);
    for (const value of values) {
      expect(value).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
      expect(atob(value).length).toBeGreaterThanOrEqual(16);
    }
  });
});

describe("S-08 HSTS", () => {
  it("max-age 至少一年並涵蓋子網域", () => {
    const maxAge = Number(/max-age=(\d+)/.exec(STRICT_TRANSPORT_SECURITY)?.[1]);
    expect(maxAge).toBeGreaterThanOrEqual(31_536_000);
    expect(STRICT_TRANSPORT_SECURITY).toContain("includeSubDomains");
  });

  it("所有路徑都套用 HSTS", () => {
    const hsts = staticSecurityHeaders.find((h) => h.key === "Strict-Transport-Security");
    expect(hsts?.value).toBe(STRICT_TRANSPORT_SECURITY);
  });
});
