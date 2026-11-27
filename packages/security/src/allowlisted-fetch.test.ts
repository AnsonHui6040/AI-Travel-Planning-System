import { describe, expect, it } from "vitest";
import { FETCH_ALLOWLIST, FETCH_API_HOSTS, allowlistedFetchAsFetch, createAllowlistedFetch, nodeTransport, pinnedLookup, type FetchLimits, type FetchTransport, type TransportResponse } from "./index";

// T16：白名單 fetch 與 SSRF 測試集（S-05）
const HOST = "www.example-rail.jp";
const OTHER = "status.example-bus.jp";
const PUBLIC_IP = "93.184.216.34";

type Reply = Partial<Omit<TransportResponse, "body">> & { chunks?: string[]; never?: boolean; stall?: boolean };

function setup(options: { dns?: Record<string, string[]>; replies?: Record<string, Reply>; limits?: Partial<FetchLimits> } = {}) {
  const dns = options.dns ?? { [HOST]: [PUBLIC_IP], [OTHER]: ["203.0.114.10"] };
  const replies = options.replies ?? {};
  const calls: { url: string; address: string; headers: Record<string, string>; method: string; body: string | undefined }[] = [];
  let cancelled = 0;
  const transport: FetchTransport = (req) => {
    calls.push({ url: req.url.href, address: req.address, headers: req.headers, method: req.method, body: req.body });
    const reply = replies[req.url.href] ?? { chunks: ["<p>ok</p>"] };
    if (reply.never) return new Promise(() => {});
    const encoder = new TextEncoder();
    async function* body() {
      for (const chunk of reply.chunks ?? []) yield encoder.encode(chunk);
      if (reply.stall) await new Promise(() => {});
    }
    return Promise.resolve({
      status: reply.status ?? 200,
      headers: { "content-type": "text/html; charset=utf-8", ...reply.headers },
      body: body(),
      cancel: () => {
        cancelled += 1;
      },
    });
  };
  const fetch = createAllowlistedFetch({
    allowlist: [HOST, OTHER],
    resolve: (host) => {
      const found = dns[host];
      return found ? Promise.resolve(found) : Promise.reject(new Error("ENOTFOUND"));
    },
    transport,
    ...(options.limits ? { limits: options.limits } : {}),
  });
  return { fetch, calls, cancelled: () => cancelled };
}

describe("白名單 fetch：允許的請求", () => {
  it("白名單網域、公開位址：回傳內容，並連線到驗證過的位址", async () => {
    const { fetch, calls } = setup();
    const result = await fetch(`https://${HOST}/info`);
    expect(result).toEqual({ ok: true, url: `https://${HOST}/info`, status: 200, contentType: "text/html", body: "<p>ok</p>" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.address).toBe(PUBLIC_IP);
  });

  it("網域比對不分大小寫", async () => {
    const { fetch } = setup();
    expect((await fetch(`https://WWW.Example-Rail.JP/`)).ok).toBe(true);
  });

  it("不送出 cookie、授權或其他識別標頭", async () => {
    const { fetch, calls } = setup();
    await fetch(`https://${HOST}/`);
    expect(Object.keys(calls[0]?.headers ?? {}).sort()).toEqual(["accept", "accept-encoding", "user-agent"]);
    expect(calls[0]?.headers["accept-encoding"]).toBe("identity");
  });

  it("相對路徑的 redirect 在白名單內時跟隨", async () => {
    const { fetch, calls } = setup({ replies: { [`https://${HOST}/a`]: { status: 301, headers: { location: "/b" }, chunks: [] } } });
    const result = await fetch(`https://${HOST}/a`);
    expect(result.ok && result.url).toBe(`https://${HOST}/b`);
    expect(calls.map((c) => c.url)).toEqual([`https://${HOST}/a`, `https://${HOST}/b`]);
  });
});

describe("SSRF 測試集：全部被擋，且沒有建立連線", () => {
  it.each([
    ["https://127.0.0.1/", "ip_literal"],
    ["https://[::1]/", "ip_literal"],
    ["https://169.254.169.254/latest/meta-data/", "ip_literal"],
    ["https://10.0.0.5/", "ip_literal"],
    ["https://2130706433/", "ip_literal"],
    ["https://0x7f.0.0.1/", "ip_literal"],
    [`http://${HOST}/`, "not_https"],
    [`file:///etc/passwd`, "not_https"],
    [`https://${HOST}:8443/`, "bad_port"],
    [`https://user:pass@${HOST}/`, "credentials"],
    ["https://evil.example.com/", "not_allowlisted"],
    [`https://sub.${HOST}/`, "not_allowlisted"],
    [`https://${HOST}.evil.com/`, "not_allowlisted"],
    ["https://localhost/", "not_allowlisted"],
    ["not a url", "invalid_url"],
  ])("%s → %s", async (url, reason) => {
    const { fetch, calls } = setup();
    const result = await fetch(url);
    expect(result).toMatchObject({ ok: false, reason });
    expect(calls).toHaveLength(0);
  });

  it.each([["10.1.2.3"], ["127.0.0.1"], ["169.254.169.254"], ["::1"], ["fd00::1"], ["::ffff:10.0.0.1"]])(
    "白名單網域的 DNS 解析至私有位址 %s 時拒絕",
    async (ip) => {
      const { fetch, calls } = setup({ dns: { [HOST]: [ip] } });
      expect(await fetch(`https://${HOST}/`)).toMatchObject({ ok: false, reason: "private_address" });
      expect(calls).toHaveLength(0);
    },
  );

  it("解析結果中只要有一個私有位址就拒絕", async () => {
    const { fetch, calls } = setup({ dns: { [HOST]: [PUBLIC_IP, "10.0.0.1"] } });
    expect(await fetch(`https://${HOST}/`)).toMatchObject({ ok: false, reason: "private_address" });
    expect(calls).toHaveLength(0);
  });

  it("DNS 解析失敗或沒有位址時拒絕", async () => {
    const empty = setup({ dns: { [HOST]: [] } });
    expect(await empty.fetch(`https://${HOST}/`)).toMatchObject({ ok: false, reason: "dns_failed" });
    const missing = setup({ dns: {} });
    expect(await missing.fetch(`https://${HOST}/`)).toMatchObject({ ok: false, reason: "dns_failed" });
  });

  it.each([
    ["https://evil.example.com/", "not_allowlisted"],
    ["http://www.example-rail.jp/next", "not_https"],
    ["https://169.254.169.254/latest/meta-data/", "ip_literal"],
    ["https://www.example-rail.jp:444/", "bad_port"],
  ])("redirect 至 %s 時拒絕（%s），不連線到新位置", async (location, reason) => {
    const { fetch, calls } = setup({ replies: { [`https://${HOST}/`]: { status: 302, headers: { location }, chunks: [] } } });
    expect(await fetch(`https://${HOST}/`)).toMatchObject({ ok: false, reason });
    expect(calls).toHaveLength(1);
  });

  it("redirect 至另一個白名單網域時重新檢查 DNS 位址", async () => {
    const { fetch, calls } = setup({
      dns: { [HOST]: [PUBLIC_IP], [OTHER]: ["192.168.0.10"] },
      replies: { [`https://${HOST}/`]: { status: 307, headers: { location: `https://${OTHER}/` }, chunks: [] } },
    });
    expect(await fetch(`https://${HOST}/`)).toMatchObject({ ok: false, reason: "private_address" });
    expect(calls).toHaveLength(1);
  });

  it("redirect 次數超過上限時停止", async () => {
    const replies: Record<string, Reply> = {};
    for (let i = 0; i < 10; i++) replies[`https://${HOST}/${i}`] = { status: 302, headers: { location: `/${i + 1}` }, chunks: [] };
    const { fetch, calls } = setup({ replies, limits: { maxRedirects: 3 } });
    expect(await fetch(`https://${HOST}/0`)).toMatchObject({ ok: false, reason: "too_many_redirects" });
    expect(calls).toHaveLength(4);
  });

  it("redirect 沒有 location 時拒絕", async () => {
    const { fetch } = setup({ replies: { [`https://${HOST}/`]: { status: 302, chunks: [] } } });
    expect(await fetch(`https://${HOST}/`)).toMatchObject({ ok: false, reason: "http_status" });
  });
});

describe("回應限制", () => {
  it("內容類型不在允許清單時拒絕，不讀取內容", async () => {
    const { fetch, cancelled } = setup({ replies: { [`https://${HOST}/`]: { headers: { "content-type": "image/png" } } } });
    expect(await fetch(`https://${HOST}/`)).toMatchObject({ ok: false, reason: "bad_content_type" });
    expect(cancelled()).toBe(1);
  });

  it("沒有內容類型時拒絕", async () => {
    const { fetch } = setup({ replies: { [`https://${HOST}/`]: { headers: { "content-type": undefined } } } });
    expect(await fetch(`https://${HOST}/`)).toMatchObject({ ok: false, reason: "bad_content_type" });
  });

  it("宣告的長度超過上限時拒絕", async () => {
    const { fetch, cancelled } = setup({ replies: { [`https://${HOST}/`]: { headers: { "content-length": "999999" } } }, limits: { maxBytes: 1000 } });
    expect(await fetch(`https://${HOST}/`)).toMatchObject({ ok: false, reason: "too_large" });
    expect(cancelled()).toBe(1);
  });

  it("實際內容超過上限時中斷", async () => {
    const { fetch, cancelled } = setup({ replies: { [`https://${HOST}/`]: { chunks: ["a".repeat(600), "b".repeat(600)] } }, limits: { maxBytes: 1000 } });
    expect(await fetch(`https://${HOST}/`)).toMatchObject({ ok: false, reason: "too_large" });
    expect(cancelled()).toBe(1);
  });

  it("沒有回應時逾時", async () => {
    const { fetch } = setup({ replies: { [`https://${HOST}/`]: { never: true } }, limits: { timeoutMs: 30 } });
    expect(await fetch(`https://${HOST}/`)).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("內容傳送中停住時逾時並中斷", async () => {
    const { fetch, cancelled } = setup({ replies: { [`https://${HOST}/`]: { chunks: ["a"], stall: true } }, limits: { timeoutMs: 30 } });
    expect(await fetch(`https://${HOST}/`)).toMatchObject({ ok: false, reason: "timeout" });
    expect(cancelled()).toBe(1);
  });

  it("非 2xx 狀態回傳失敗與狀態碼", async () => {
    const { fetch } = setup({ replies: { [`https://${HOST}/`]: { status: 404 } } });
    expect(await fetch(`https://${HOST}/`)).toMatchObject({ ok: false, reason: "http_status", status: 404 });
  });

  it("連線錯誤回傳失敗", async () => {
    const fetch = createAllowlistedFetch({
      allowlist: [HOST],
      resolve: () => Promise.resolve([PUBLIC_IP]),
      transport: () => Promise.reject(new Error("ECONNRESET")),
    });
    expect(await fetch(`https://${HOST}/`)).toMatchObject({ ok: false, reason: "network_error" });
  });
});

describe("白名單設定", () => {
  it("repo 設定檔的每個項目都是小寫主機名稱，沒有 IP、萬用字元或重複", () => {
    expect(new Set(FETCH_ALLOWLIST).size).toBe(FETCH_ALLOWLIST.length);
    for (const host of FETCH_ALLOWLIST) {
      expect(host).toMatch(/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);
    }
    expect(Object.isFrozen(FETCH_ALLOWLIST)).toBe(true);
  });

  it.each([["127.0.0.1"], ["*.example.com"], ["localhost"], ["Example.com"], ["example.com:443"], [""]])("白名單項目 %s 不合格時拒絕建立", (host) => {
    expect(() => createAllowlistedFetch({ allowlist: [host] })).toThrow();
  });
});

describe("Node 連線層", () => {
  it("DNS 查詢固定回傳已驗證的位址，忽略主機名稱再次解析", () => {
    const results: unknown[] = [];
    pinnedLookup(PUBLIC_IP)("attacker-controlled.example", {}, (err, address, family) => results.push([err, address, family]));
    pinnedLookup("2001:4860:4860::8888")(HOST, { all: true }, (err, address) => results.push([err, address]));
    expect(results).toEqual([
      [null, PUBLIC_IP, 4],
      [null, [{ address: "2001:4860:4860::8888", family: 6 }]],
    ]);
  });

  it("連線到指定位址，不經 DNS 解析主機名稱", async () => {
    // .invalid 網域無法解析；若連線層自行解析會得到 ENOTFOUND。固定到 127.0.0.1 的未使用埠則是連線被拒
    const error = await nodeTransport({
      url: new URL("https://pinned-check.invalid/"),
      address: "127.0.0.1",
      headers: {},
      signal: AbortSignal.timeout(2000),
      method: "GET",
      body: undefined,
    }).then(
      () => null,
      (e: unknown) => e as NodeJS.ErrnoException,
    );
    expect(error?.code).not.toBe("ENOTFOUND");
    expect(error?.code).toMatch(/ECONNREFUSED|EPROTO|ECONNRESET|ERR_SSL/);
  });
});

// 決策 0010 S：Places 文字搜尋需要 POST、JSON 內容與 key 標頭。只在該次請求帶出，不跟隨 redirect
describe("白名單 fetch：帶內容與標頭的請求", () => {
  it("POST 送出內容與指定標頭，仍連線到驗證過的位址", async () => {
    const { fetch, calls } = setup({ replies: { [`https://${HOST}/search`]: { headers: { "content-type": "application/json; charset=UTF-8" }, chunks: ['{"places":[]}'] } } });
    const result = await fetch(`https://${HOST}/search`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": "fake", "x-goog-fieldmask": "places.id" },
      body: '{"textQuery":"ramen"}',
    });
    expect(result).toMatchObject({ ok: true, contentType: "application/json", body: '{"places":[]}' });
    expect(calls[0]).toMatchObject({ method: "POST", body: '{"textQuery":"ramen"}', address: PUBLIC_IP });
    expect(calls[0]?.headers["x-goog-api-key"]).toBe("fake");
    expect(calls[0]?.headers["accept-encoding"]).toBe("identity");
  });

  it("沒有指定時為 GET、不帶內容", async () => {
    const { fetch, calls } = setup();
    await fetch(`https://${HOST}/`);
    expect(calls[0]).toMatchObject({ method: "GET", body: undefined });
  });

  it("帶標頭或內容的請求不跟隨 redirect，避免把 key 送到其他位置", async () => {
    const { fetch, calls } = setup({ replies: { [`https://${HOST}/a`]: { status: 302, headers: { location: `https://${OTHER}/steal` }, chunks: [] } } });
    const result = await fetch(`https://${HOST}/a`, { method: "POST", headers: { "x-goog-api-key": "k" }, body: "{}" });
    expect(result).toMatchObject({ ok: false, reason: "redirect_refused" });
    expect(calls).toHaveLength(1);
  });

  it.each(["host", "cookie", "accept-encoding", "content-length", "Bad Header"])("不接受標頭 %s", async (name) => {
    const { fetch, calls } = setup();
    expect(await fetch(`https://${HOST}/`, { headers: { [name]: "x" } })).toMatchObject({ ok: false, reason: "bad_request" });
    expect(calls).toHaveLength(0);
  });

  it("內容超過 16 KB 時不送出", async () => {
    const { fetch, calls } = setup();
    expect(await fetch(`https://${HOST}/`, { method: "POST", body: "x".repeat(16 * 1024 + 1) })).toMatchObject({ ok: false, reason: "bad_request" });
    expect(calls).toHaveLength(0);
  });

  it("GET 不可帶內容", async () => {
    const { fetch } = setup();
    expect(await fetch(`https://${HOST}/`, { body: "{}" })).toMatchObject({ ok: false, reason: "bad_request" });
  });
});

describe("白名單 fetch 轉為 fetch 介面（供 adapter 使用）", () => {
  it("成功時回傳 Response；非 2xx 回傳同一狀態碼；被擋下時丟出錯誤", async () => {
    const { fetch } = setup({
      replies: {
        [`https://${HOST}/ok`]: { headers: { "content-type": "application/json" }, chunks: ['{"a":1}'] },
        [`https://${HOST}/denied`]: { status: 403, chunks: [] },
      },
    });
    const asFetch = allowlistedFetchAsFetch(fetch);
    const ok = await asFetch(`https://${HOST}/ok`, { method: "POST", headers: { "x-goog-api-key": "k" }, body: "{}" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ a: 1 });
    expect((await asFetch(`https://${HOST}/denied`)).status).toBe(403);
    await expect(asFetch("https://not-allowed.example.com/")).rejects.toThrow();
  });
});

describe("官方 API 主機（決策 0010）", () => {
  it("Places 文字搜尋的主機另列，不在讀取網頁的白名單", () => {
    expect(FETCH_API_HOSTS).toEqual(["places.googleapis.com"]);
    expect(FETCH_ALLOWLIST).not.toContain("places.googleapis.com");
  });
});
