import { describe, expect, it } from "vitest";
import { parseEditForm, submitEdit, type EditContext, type EditDeps } from "./item-edit-core";

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
