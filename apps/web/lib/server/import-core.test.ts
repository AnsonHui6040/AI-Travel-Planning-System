import { defaultRoleSetting, type ProviderAdapter, type ProviderRequest } from "@atps/core";
import { importSpec } from "@atps/ai";
import { describe, expect, it } from "vitest";
import { confirmImport, type ImportConfirmDeps } from "./import-confirm-core";
import { previewImport, type ImportContext, type ImportPreviewDeps } from "./import-core";

// 決策 0010 I：行程匯入的 Server Action 邏輯。
// 預覽：貼上的文字移除全名、電話、電子郵件後放在資料區塊（S-03、S-07），以使用者本人的 AI 設定與 key 執行；輸出經 gateImportOutput，只回傳預覽（S-01）。
// 確認：只有勾選的列，以本人 session 經預訂與行程編輯的寫入路徑寫入。

const TRIP = "e7000000-0000-4000-8000-000000000001";
const KEY = "test-only-key-0007";
const PASTED = "訂房確認\n預訂者姓名：王小明\n電話 +886 912-345-678\nxiaoming@example.com\n入住 2026-12-20 15:00\n訂單編號 HTL-55821";

const OUTPUT = {
  bookings: [
    {
      kind: "lodging",
      title: "新宿華盛頓飯店",
      start_date: "2026-12-20",
      start_time: "15:00",
      end_date: "2026-12-23",
      end_time: "11:00",
      timezone: null,
      location: null,
      confirmation_code: "HTL-55821",
      note: null,
    },
  ],
  places: [{ name: "淺草寺", type: "attraction", date: "2026-12-21", start_time: "09:00", note: null }],
};

function context(overrides: Partial<ImportContext> = {}): ImportContext {
  const setting = defaultRoleSetting("master_planner");
  return {
    tripId: TRIP,
    userId: "u1",
    timezone: "Asia/Tokyo",
    dates: ["2026-12-20", "2026-12-21", "2026-12-22", "2026-12-23"],
    canEdit: true,
    setting,
    knownValues: ["陳美華"],
    forbiddenValues: [KEY, "陳美華"],
    ...overrides,
  };
}

function previewDeps(options: { ctx?: ImportContext | null; outputs?: unknown[]; key?: string | null; fail?: boolean; rate?: boolean } = {}) {
  const requests: ProviderRequest[] = [];
  const logs: string[] = [];
  const outputs = [...(options.outputs ?? [OUTPUT])];
  const adapter: ProviderAdapter = {
    id: "fake",
    authMethods: ["api_key"],
    builtInSearch: false,
    generate: async (request) => {
      requests.push(request);
      if (options.fail) throw new Error("boom");
      return { output: outputs.length > 1 ? outputs.shift() : outputs[0], usage: { inputTokens: 100, outputTokens: 50 }, citations: [] };
    },
    classifyError: () => "interrupted",
  };
  const deps: ImportPreviewDeps = {
    getUser: async () => ({ id: "u1" }),
    checkRateLimit: async () => options.rate ?? true,
    load: async () => (options.ctx === undefined ? context() : options.ctx),
    adapterFor: () => adapter,
    credentialFor: async () => (options.key === null ? null : { kind: "api_key", secret: options.key ?? KEY }),
    recordUsage: async () => {},
    logError: (m) => void logs.push(m),
  };
  return { deps, requests, logs };
}

const form = (text: string) => ({ tripId: TRIP, text });

describe("previewImport", () => {
  it("貼上的文字移除全名、電話、電子郵件後放在資料區塊，回傳可編輯的預覽列", async () => {
    const { deps, requests } = previewDeps();
    const result = await previewImport(deps, importSpec(), form(PASTED));
    expect(result).toMatchObject({ state: "ok", removed: { email: 1, phone: 1, name: 1 } });
    if (result.state !== "ok") throw new Error("unreachable");
    expect(result.preview.bookings[0]).toMatchObject({ title: "新宿華盛頓飯店", timezone: "Asia/Tokyo", confirmationCode: "HTL-55821", selected: true });
    expect(result.preview.places[0]).toMatchObject({ name: "淺草寺", date: "2026-12-21", start: "09:00" });

    expect(requests).toHaveLength(1);
    const sent = JSON.stringify(requests[0]);
    for (const removed of ["王小明", "912-345-678", "xiaoming@example.com", KEY]) expect(sent).not.toContain(removed);
    expect(requests[0]?.input).toMatch(/\[資料開始 [0-9a-f]{24}\] 種類：貼上的文字/);
    expect(requests[0]?.input).toContain("HTL-55821");
    expect(requests[0]?.tools).toEqual([]);
  });

  it("沒有 AI key 或模型時提示到設定", async () => {
    const result = await previewImport(previewDeps({ key: null }).deps, importSpec(), form(PASTED));
    expect(result).toEqual({ state: "no_key", message: "尚未設定 Claude 的 API key。請到「更多 → API key」輸入，或在「AI 設定」為 Master Planner 選擇其他 AI。" });
  });

  it("沒有辨識到任何預訂或地點時清楚說明", async () => {
    const result = await previewImport(previewDeps({ outputs: [{ bookings: [], places: [] }] }).deps, importSpec(), form("今天天氣很好"));
    expect(result).toEqual({ state: "empty", message: "沒有辨識到預訂或地點。請貼上確認信、行程或地點清單的文字。" });
  });

  it("輸出無法解析（重試後仍不符格式）或被輸出檢查拒絕時清楚說明，log 不含內容", async () => {
    const invalid = previewDeps({ outputs: [{ wrong: true }] });
    expect(await previewImport(invalid.deps, importSpec(), form(PASTED))).toEqual({
      state: "error",
      message: "無法辨識貼上的內容，請確認是預訂確認信或行程的文字後再試一次。",
    });
    const leak = previewDeps({ outputs: [{ ...OUTPUT, places: [{ ...OUTPUT.places[0], note: `key ${KEY}` }] }] });
    expect(await previewImport(leak.deps, importSpec(), form(PASTED))).toMatchObject({ state: "error" });
    expect(leak.logs).toEqual(["匯入輸出被拒絕（leak）"]);
    expect(JSON.stringify(leak.logs)).not.toContain(KEY);
  });

  it("AI 服務失敗時說明，不自動改用其他家（C-08）", async () => {
    const { deps, requests } = previewDeps({ fail: true });
    expect(await previewImport(deps, importSpec(), form(PASTED))).toEqual({
      state: "error",
      message: "Claude 暫時無法使用，請稍後再試，或在「AI 設定」把 Master Planner 改用其他 AI。",
    });
    expect(requests).toHaveLength(1);
  });

  it("登入、速率限制、權限與輸入檢查", async () => {
    expect(await previewImport({ ...previewDeps().deps, getUser: async () => null }, importSpec(), form(PASTED))).toEqual({ state: "error", message: "需要登入" });
    expect(await previewImport(previewDeps({ rate: false }).deps, importSpec(), form(PASTED))).toEqual({ state: "error", message: "操作過於頻繁，請稍後再試" });
    expect(await previewImport(previewDeps({ ctx: null }).deps, importSpec(), form(PASTED))).toEqual({ state: "error", message: "找不到這個行程" });
    expect(await previewImport(previewDeps({ ctx: context({ canEdit: false }) }).deps, importSpec(), form(PASTED))).toEqual({
      state: "error",
      message: "只有 Owner 與 Companion 可以匯入",
    });
    expect(await previewImport(previewDeps().deps, importSpec(), form("   "))).toEqual({ state: "error", message: "請貼上要匯入的文字" });
    expect(await previewImport(previewDeps().deps, importSpec(), form("字".repeat(50_001)))).toEqual({ state: "error", message: "文字太長，請分段貼上（最多 50000 字）" });
    expect(await previewImport(previewDeps().deps, importSpec(), { tripId: "x", text: PASTED })).toEqual({ state: "error", message: "行程不正確" });
  });
});

const bookingRow = {
  key: "b1",
  kind: "lodging",
  title: "新宿華盛頓飯店",
  startDate: "2026-12-20",
  startTime: "15:00",
  endDate: "2026-12-23",
  endTime: "11:00",
  timezone: "Asia/Tokyo",
  location: "",
  confirmationCode: "HTL-55821",
  note: "",
};
const placeRow = { key: "p1", name: "淺草寺", type: "attraction", date: "2026-12-21", start: "09:00", stayMinutes: 60, note: "" };

function confirmDeps(options: { booking?: { ok: boolean; message: string }; place?: { ok: true; mode: "direct" | "proposal" } | { ok: false; message: string } } = {}) {
  const calls: Array<[string, unknown]> = [];
  const deps: ImportConfirmDeps = {
    getUser: async () => ({ id: "u1" }),
    checkRateLimit: async () => true,
    saveBooking: async (raw) => {
      calls.push(["booking", raw]);
      return options.booking ?? { ok: true, message: "已儲存預訂", id: "x" };
    },
    addPlace: async (tripId, form) => {
      calls.push(["place", [tripId, Object.fromEntries(form)]]);
      const r = options.place ?? { ok: true, mode: "direct" };
      return r.ok ? { ...r, message: "", itemId: null, warnings: [] } : r;
    },
  };
  return { deps, calls };
}

describe("confirmImport", () => {
  it("預訂經預訂的寫入路徑、地點經新增地點的寫入路徑（來源為使用者新增、沒有 place_id）", async () => {
    const { deps, calls } = confirmDeps();
    const result = await confirmImport(deps, { tripId: TRIP, bookings: [bookingRow], places: [placeRow] });
    expect(result).toEqual({ ok: true, message: "已加入 1 筆預訂、1 個地點", failures: [] });
    expect(calls).toEqual([
      ["booking", { tripId: TRIP, bookingId: null, kind: "lodging", title: "新宿華盛頓飯店", startDate: "2026-12-20", startTime: "15:00", endDate: "2026-12-23", endTime: "11:00", timezone: "Asia/Tokyo", location: "", confirmationCode: "HTL-55821", note: "", itemId: null }],
      [
        "place",
        [TRIP, { kind: "add", name_zh: "淺草寺", type: "attraction", address: "", suggested_stay_minutes: "60", note: "", place_id: "", date: "2026-12-21", start: "09:00" }],
      ],
    ]);
  });

  it("行程鎖定後地點成為待批准提案", async () => {
    const result = await confirmImport(confirmDeps({ place: { ok: true, mode: "proposal" } }).deps, { tripId: TRIP, bookings: [], places: [placeRow] });
    expect(result).toEqual({ ok: true, message: "已送出 1 個地點的提案，批准後生效", failures: [] });
  });

  it("失敗的列列出原因，其他列照常寫入", async () => {
    const { deps, calls } = confirmDeps({ booking: { ok: false, message: "結束不可早於開始" } });
    const result = await confirmImport(deps, { tripId: TRIP, bookings: [bookingRow], places: [placeRow] });
    expect(result).toEqual({ ok: false, message: "已加入 1 個地點；1 項沒有加入", failures: [{ key: "b1", label: "新宿華盛頓飯店", message: "結束不可早於開始" }] });
    expect(calls).toHaveLength(2);
  });

  it("沒有勾選任何列、格式不正確或超過筆數時不寫入", async () => {
    const { deps, calls } = confirmDeps();
    expect(await confirmImport(deps, { tripId: TRIP, bookings: [], places: [] })).toEqual({ ok: false, message: "請至少勾選一項", failures: [] });
    expect(await confirmImport(deps, { tripId: TRIP, bookings: [{ ...bookingRow, extra: 1 }], places: [] })).toEqual({ ok: false, message: "資料不正確，請重新匯入", failures: [] });
    expect(await confirmImport(deps, { tripId: TRIP, bookings: Array(21).fill(bookingRow), places: [] })).toEqual({ ok: false, message: "資料不正確，請重新匯入", failures: [] });
    expect(calls).toEqual([]);
  });
});
