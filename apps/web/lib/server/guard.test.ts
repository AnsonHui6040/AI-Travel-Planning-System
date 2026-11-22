import { describe, expect, it, vi } from "vitest";
import { guardRequest, isAllowedOrigin } from "./guard";

const allowed = ["http://localhost:3000"];

function request(headers: Record<string, string>, method = "POST"): Request {
  return new Request("http://localhost:3000/api/x", { method, headers });
}

describe("C-11 Origin 驗證", () => {
  it("Origin 在允許清單內時通過", () => {
    expect(isAllowedOrigin(request({ origin: "http://localhost:3000" }), allowed)).toBe(true);
  });

  it("Origin 不符時拒絕", () => {
    expect(isAllowedOrigin(request({ origin: "https://evil.example" }), allowed)).toBe(false);
  });

  it("沒有 Origin 的寫入請求拒絕", () => {
    expect(isAllowedOrigin(request({}), allowed)).toBe(false);
  });

  it("沒有 Origin 的 GET 以 Sec-Fetch-Site 判斷，跨站拒絕", () => {
    expect(isAllowedOrigin(request({ "sec-fetch-site": "same-origin" }, "GET"), allowed)).toBe(true);
    expect(isAllowedOrigin(request({ "sec-fetch-site": "cross-site" }, "GET"), allowed)).toBe(false);
  });
});

describe("C-11 guardRequest", () => {
  const user = { id: "00000000-0000-0000-0000-00000000000a" };
  const base = {
    endpoint: "trips.create",
    limit: 10,
    windowSeconds: 60,
    allowedOrigins: allowed,
  };

  it("Origin 不符回應 403，不查詢登入", async () => {
    const getUser = vi.fn();
    const res = await guardRequest(request({ origin: "https://evil.example" }), {
      ...base,
      getUser,
      checkRateLimit: vi.fn(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(403);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("未登入回應 401", async () => {
    const res = await guardRequest(request({ origin: "http://localhost:3000" }), {
      ...base,
      getUser: async () => null,
      checkRateLimit: vi.fn(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(401);
  });

  it("超過速率限制回應 429", async () => {
    const res = await guardRequest(request({ origin: "http://localhost:3000" }), {
      ...base,
      getUser: async () => user,
      checkRateLimit: async () => false,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.response.status).toBe(429);
      expect(res.response.headers.get("retry-after")).toBe("60");
    }
  });

  it("以端點、上限、時間窗呼叫速率限制", async () => {
    const checkRateLimit = vi.fn(async () => true);
    const res = await guardRequest(request({ origin: "http://localhost:3000" }), {
      ...base,
      getUser: async () => user,
      checkRateLimit,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.user).toEqual(user);
    expect(checkRateLimit).toHaveBeenCalledWith("trips.create", 10, 60);
  });
});
