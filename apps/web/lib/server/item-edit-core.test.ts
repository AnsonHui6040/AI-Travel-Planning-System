import { describe, expect, it } from "vitest";
import { parseBatchForm, parseEditForm, submitBatch, submitEdit, type EditContext, type EditDeps } from "./item-edit-core";

// 決策 0010 E：編輯的 Server Action 邏輯。鎖定前直接寫入（資料庫函式），鎖定後或該日已批准時建立待批准提案
const TRIP = "e2000000-0000-4000-8000-000000000001";
const A = "e4000000-0000-4000-8000-000000000001";
const B = "e4000000-0000-4000-8000-000000000002";
const C = "e4000000-0000-4000-8000-000000000003";
const NEW = "e4000000-0000-4000-8000-0000000000ff";

function context(overrides: Partial<EditContext> = {}): EditContext {
  return {
    tripStatus: "planning",
    baseVersion: 4,
    canEdit: true,
    role: "companion",
    manualSchedule: false,
    dates: ["2026-12-01", "2026-12-02"],
    days: [
      { date: "2026-12-01", status: "draft", placements: [{ itemId: A, start: "09:00", end: "10:00" }, { itemId: B, start: "10:30", end: "11:30" }] },
      { date: "2026-12-02", status: "draft", placements: [] },
    ],
    items: [
      { id: A, name_zh: "淺草寺", scheduled_date: null, suggested_stay_minutes: 60 },
      { id: B, name_zh: "晴空塔", scheduled_date: null, suggested_stay_minutes: 60 },
      { id: C, name_zh: "上野", scheduled_date: null, suggested_stay_minutes: 90 },
    ],
    ...overrides,
  };
}

function deps(ctx: EditContext | null = context()) {
  const calls: Array<[string, ...unknown[]]> = [];
  const d: EditDeps = {
    getUser: async () => ({ id: "u1" }),
    checkRateLimit: async () => true,
    load: async () => ctx,
    newId: () => NEW,
    addItem: async (...args) => {
      calls.push(["add", ...args]);
      return NEW;
    },
    updateItem: async (...args) => void calls.push(["update", ...args]),
    deleteItem: async (...args) => void calls.push(["delete", ...args]),
    scheduleItems: async (...args) => void calls.push(["schedule", ...args]),
    propose: async (...args) => void calls.push(["propose", ...args]),
    applyOwner: async (...args) => {
      calls.push(["applied", ...args]);
      return "applied";
    },
    editBatch: async (...args) => void calls.push(["batch", ...args]),
    warnings: async (_trip, dates) => (dates.includes("2026-12-01") ? ["淺草寺：不在營業時間內"] : []),
    logError: () => {},
  };
  return { d, calls };
}

const item = { name_zh: "藏前咖啡", type: "restaurant" as const, address: null, suggested_stay_minutes: 60, note: null, place_id: null };

describe("鎖定前：直接寫入", () => {
  it("新增到候選清單：不寫入自動草案", async () => {
    const { d, calls } = deps();
    const result = await submitEdit(d, TRIP, { kind: "add", item, slot: null });
    expect(result).toMatchObject({ ok: true, mode: "direct", itemId: NEW });
    expect(calls).toEqual([["add", TRIP, item, null, []]]);
  });

  it("新增並排入某天：第一次手動排程時帶入畫面上的自動草案，回傳該日的 checkDay 提醒", async () => {
    const { d, calls } = deps();
    const result = await submitEdit(d, TRIP, { kind: "add", item, slot: { date: "2026-12-01", start: "12:00" } });
    expect(calls[0]).toEqual([
      "add",
      TRIP,
      item,
      { date: "2026-12-01", start: "12:00", end: "13:00" },
      [
        { itemId: A, date: "2026-12-01", start: "09:00", end: "10:00" },
        { itemId: B, date: "2026-12-01", start: "10:30", end: "11:30" },
      ],
    ]);
    expect(result).toMatchObject({ ok: true, warnings: ["淺草寺：不在營業時間內"] });
  });

  it("已是手動排程時不再帶入自動草案", async () => {
    const { d, calls } = deps(context({ manualSchedule: true }));
    await submitEdit(d, TRIP, { kind: "move", itemId: C, date: "2026-12-02", start: "10:00" });
    expect(calls).toEqual([["schedule", TRIP, [{ itemId: C, date: "2026-12-02", start: "10:00", end: "11:30" }], []]]);
  });

  it("下移：與下一項交換", async () => {
    const { d, calls } = deps(context({ manualSchedule: true }));
    await submitEdit(d, TRIP, { kind: "reorder", itemId: A, direction: "down" });
    expect(calls).toEqual([
      [
        "schedule",
        TRIP,
        [
          { itemId: B, date: "2026-12-01", start: "09:00", end: "10:00" },
          { itemId: A, date: "2026-12-01", start: "10:30", end: "11:30" },
        ],
        [],
      ],
    ]);
  });

  it("最後一項不能下移", async () => {
    const { d, calls } = deps();
    expect(await submitEdit(d, TRIP, { kind: "reorder", itemId: B, direction: "down" })).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });

  it("移回候選清單、修改、刪除", async () => {
    const { d, calls } = deps(context({ manualSchedule: true }));
    await submitEdit(d, TRIP, { kind: "unschedule", itemId: A });
    await submitEdit(d, TRIP, { kind: "update", itemId: A, fields: { note: "要排隊" } });
    await submitEdit(d, TRIP, { kind: "delete", itemId: B });
    expect(calls).toEqual([
      ["schedule", TRIP, [{ itemId: A, date: null, start: null, end: null }], []],
      ["update", A, { note: "要排隊" }],
      ["delete", B],
    ]);
  });

  it("停留時間超過當天時不送出", async () => {
    const { d, calls } = deps();
    expect(await submitEdit(d, TRIP, { kind: "move", itemId: C, date: "2026-12-02", start: "23:00" })).toMatchObject({ ok: false, message: "停留時間超過當天，請提早開始時間" });
    expect(calls).toEqual([]);
  });

  it("日期不在行程期間內時不送出", async () => {
    const { d } = deps();
    expect(await submitEdit(d, TRIP, { kind: "move", itemId: C, date: "2026-12-09", start: "10:00" })).toMatchObject({ ok: false });
  });
});

describe("鎖定後或該日已批准：建立待批准提案", () => {
  const locked = () =>
    context({
      tripStatus: "locked",
      days: [
        { date: "2026-12-01", status: "approved", placements: [{ itemId: A, start: "09:00", end: "10:00" }, { itemId: B, start: "10:30", end: "11:30" }] },
        { date: "2026-12-02", status: "approved", placements: [] },
      ],
      items: [
        { id: A, name_zh: "淺草寺", scheduled_date: "2026-12-01", suggested_stay_minutes: 60 },
        { id: B, name_zh: "晴空塔", scheduled_date: "2026-12-01", suggested_stay_minutes: 60 },
        { id: C, name_zh: "上野", scheduled_date: null, suggested_stay_minutes: 90 },
      ],
    });

  it("新增：add_item 提案（項目編號由伺服器產生），不直接寫入", async () => {
    const { d, calls } = deps(locked());
    const result = await submitEdit(d, TRIP, { kind: "add", item, slot: { date: "2026-12-01", start: "12:00" } });
    expect(result).toMatchObject({ ok: true, mode: "proposal", warnings: [] });
    expect(calls).toEqual([
      [
        "propose",
        TRIP,
        4,
        {
          changeKind: "minor_non_incident",
          versionKind: "minor",
          summary: "新增藏前咖啡",
          operations: [{ op: "add_item", itemId: NEW, item, date: "2026-12-01", start: "12:00", end: "13:00" }],
        },
        ["2026-12-01"],
      ],
    ]);
  });

  it("移到另一天：Major 提案", async () => {
    const { d, calls } = deps(locked());
    await submitEdit(d, TRIP, { kind: "move", itemId: A, date: "2026-12-02", start: "10:00" });
    expect(calls[0]?.[3]).toMatchObject({ changeKind: "major_version", versionKind: "major" });
    expect(calls[0]?.[4]).toEqual(["2026-12-01", "2026-12-02"]);
  });

  it("排序、刪除與修改都成為提案", async () => {
    const { d, calls } = deps(locked());
    await submitEdit(d, TRIP, { kind: "reorder", itemId: B, direction: "up" });
    await submitEdit(d, TRIP, { kind: "delete", itemId: A });
    await submitEdit(d, TRIP, { kind: "update", itemId: A, fields: { suggested_stay_minutes: 30 } });
    expect(calls.map((c) => c[0])).toEqual(["propose", "propose", "propose"]);
    expect(calls[0]?.[3]).toMatchObject({ summary: "調整晴空塔的順序", operations: [{ op: "schedule_item" }, { op: "schedule_item" }] });
    expect(calls[1]?.[3]).toMatchObject({ operations: [{ op: "remove_item", itemId: A }] });
  });

  it("規劃中但移到已批准的日期：成為提案", async () => {
    const [first] = context().days;
    if (!first) throw new Error("fixture");
    const ctx = context({ days: [first, { date: "2026-12-02", status: "approved", placements: [] }] });
    const { d, calls } = deps(ctx);
    const result = await submitEdit(d, TRIP, { kind: "move", itemId: C, date: "2026-12-02", start: "10:00" });
    expect(result).toMatchObject({ ok: true, mode: "proposal" });
    expect(calls[0]?.[0]).toBe("propose");
  });

  it("旅後不可編輯；Viewer 不可編輯", async () => {
    expect(await submitEdit(deps(context({ tripStatus: "ended" })).d, TRIP, { kind: "delete", itemId: A })).toMatchObject({ ok: false });
    expect(await submitEdit(deps(context({ canEdit: false })).d, TRIP, { kind: "delete", itemId: A })).toMatchObject({ ok: false, message: "只有 Owner 與 Companion 可以編輯" });
  });
});

describe("表單解析", () => {
  const form = (entries: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.set(k, v);
    return f;
  };

  it("新增：名稱、類型、停留必填；地址與備註可空；日期與時間同時填寫", () => {
    expect(parseEditForm(form({ kind: "add", name_zh: " 藏前咖啡 ", type: "restaurant", suggested_stay_minutes: "60", address: "", note: "" }))).toEqual({
      ok: true,
      request: { kind: "add", item, slot: null },
    });
    expect(parseEditForm(form({ kind: "add", name_zh: "x", type: "restaurant", suggested_stay_minutes: "60", date: "2026-12-01" }))).toMatchObject({ ok: false });
    expect(parseEditForm(form({ kind: "add", name_zh: "", type: "restaurant", suggested_stay_minutes: "60" }))).toMatchObject({ ok: false });
  });

  it("搜尋選定的地點只帶 place_id（D28）", () => {
    const parsed = parseEditForm(form({ kind: "add", name_zh: "一蘭", type: "restaurant", suggested_stay_minutes: "45", place_id: "ChIJsynthetic-place-0001" }));
    expect(parsed).toMatchObject({ ok: true, request: { item: { place_id: "ChIJsynthetic-place-0001" } } });
    expect(parseEditForm(form({ kind: "add", name_zh: "一蘭", type: "restaurant", suggested_stay_minutes: "45", place_id: "javascript:" }))).toMatchObject({ ok: false });
  });

  it("修改只送出有變更的欄位；未知動作拒絕", () => {
    expect(
      parseEditForm(form({ kind: "update", itemId: A, name_zh: "淺草寺", type: "attraction", suggested_stay_minutes: "45", address: "", note: "排隊" }), {
        name_zh: "淺草寺",
        type: "attraction",
        address: null,
        suggested_stay_minutes: 60,
        note: null,
      }),
    ).toEqual({ ok: true, request: { kind: "update", itemId: A, fields: { suggested_stay_minutes: 45, note: "排隊" } } });
    expect(parseEditForm(form({ kind: "explode", itemId: A }))).toMatchObject({ ok: false });
  });
});

describe("決策 0011：鎖定後 Owner 直接套用", () => {
  const locked = (role: "owner" | "companion") =>
    context({
      tripStatus: "locked",
      role,
      days: [
        { date: "2026-12-01", status: "approved", placements: [{ itemId: A, start: "09:00", end: "10:00" }, { itemId: B, start: "10:30", end: "11:30" }] },
        { date: "2026-12-02", status: "approved", placements: [] },
      ],
      items: [
        { id: A, name_zh: "淺草寺", scheduled_date: "2026-12-01", suggested_stay_minutes: 60 },
        { id: B, name_zh: "晴空塔", scheduled_date: "2026-12-01", suggested_stay_minutes: 60 },
        { id: C, name_zh: "上野", scheduled_date: null, suggested_stay_minutes: 90 },
      ],
    });

  it("Owner 的修改直接套用（以提案內容寫入 Change Log），不建立待批准提案", async () => {
    const { d, calls } = deps(locked("owner"));
    const result = await submitEdit(d, TRIP, { kind: "move", itemId: A, date: "2026-12-01", start: "12:00", end: "13:30" });
    expect(result).toMatchObject({ ok: true, mode: "applied", message: "已套用，其他成員會收到通知" });
    expect(calls[0]?.[0]).toBe("applied");
    expect(calls[0]?.[3]).toMatchObject({ operations: [{ op: "schedule_item", itemId: A, date: "2026-12-01", start: "12:00", end: "13:30" }] });
  });

  it("Companion 的同一個修改成為待批准提案", async () => {
    const { d, calls } = deps(locked("companion"));
    const result = await submitEdit(d, TRIP, { kind: "move", itemId: A, date: "2026-12-01", start: "12:00" });
    expect(result).toMatchObject({ ok: true, mode: "proposal" });
    expect(calls[0]?.[0]).toBe("propose");
  });

  it("行程已被其他人修改（SH-04）：請重新整理", async () => {
    const { d } = deps(locked("owner"));
    d.applyOwner = async () => "invalidated";
    expect(await submitEdit(d, TRIP, { kind: "delete", itemId: A })).toMatchObject({ ok: false, message: "行程剛被修改，請重新整理後再試" });
  });

  it("複製：同一天接在原項目之後", async () => {
    const { d, calls } = deps(locked("owner"));
    await submitEdit(d, TRIP, { kind: "duplicate", itemId: B, item });
    expect(calls[0]?.[3]).toMatchObject({
      operations: [{ op: "add_item", itemId: NEW, item, date: "2026-12-01", start: "11:30", end: "12:30" }],
    });
  });

  it("整天交換：兩天的項目一次套用", async () => {
    const { d, calls } = deps(locked("owner"));
    const result = await submitEdit(d, TRIP, { kind: "swap", date: "2026-12-01", other: "2026-12-02" });
    expect(result).toMatchObject({ ok: true, mode: "applied" });
    expect(calls[0]?.[3]).toMatchObject({
      operations: [
        { op: "schedule_item", itemId: A, date: "2026-12-02", start: "09:00", end: "10:00" },
        { op: "schedule_item", itemId: B, date: "2026-12-02", start: "10:30", end: "11:30" },
      ],
    });
  });
});

describe("決策 0011：編輯模式的批次", () => {
  const batch = {
    date: "2026-12-01",
    placements: [
      { itemId: B, start: "09:00", end: "10:00" },
      { itemId: A, start: "10:30", end: "11:30" },
    ],
    removed: [],
    added: [],
  };

  it("鎖定前：一個批次直接寫入（帶入自動草案）", async () => {
    const { d, calls } = deps();
    const result = await submitBatch(d, TRIP, batch);
    expect(result).toMatchObject({ ok: true, mode: "direct" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("batch");
    expect(calls[0]?.[2]).toEqual([
      { op: "schedule_item", itemId: B, date: "2026-12-01", start: "09:00", end: "10:00" },
      { op: "schedule_item", itemId: A, date: "2026-12-01", start: "10:30", end: "11:30" },
    ]);
  });

  it("沒有變更時不送出", async () => {
    const { d, calls } = deps();
    const same = { ...batch, placements: [{ itemId: A, start: "09:00", end: "10:00" }, { itemId: B, start: "10:30", end: "11:30" }] };
    expect(await submitBatch(d, TRIP, same)).toMatchObject({ ok: false, message: "沒有變更" });
    expect(calls).toEqual([]);
  });

  it("時段重疊時不送出", async () => {
    const { d } = deps();
    const overlap = { ...batch, placements: [{ itemId: A, start: "09:00", end: "10:00" }, { itemId: B, start: "09:30", end: "10:30" }] };
    expect(await submitBatch(d, TRIP, overlap)).toMatchObject({ ok: false, message: "時段重疊，請調整時間或使用自動順延" });
  });

  it("鎖定後 Companion：一個提案", async () => {
    const ctx = context({ tripStatus: "locked", days: [{ date: "2026-12-01", status: "approved", placements: [{ itemId: A, start: "09:00", end: "10:00" }, { itemId: B, start: "10:30", end: "11:30" }] }] });
    const { d, calls } = deps(ctx);
    const result = await submitBatch(d, TRIP, { ...batch, removed: [], added: [{ itemId: NEW, item, start: "12:00", end: "13:00" }] });
    expect(result).toMatchObject({ ok: true, mode: "proposal" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("propose");
  });

  it("表單：JSON 內容經 schema 檢查", () => {
    const form = new FormData();
    form.set("batch", JSON.stringify(batch));
    expect(parseBatchForm(form)).toEqual({ ok: true, batch });
    form.set("batch", JSON.stringify({ ...batch, placements: [{ itemId: A, start: "25:00", end: "10:00" }] }));
    expect(parseBatchForm(form)).toMatchObject({ ok: false });
  });
});
