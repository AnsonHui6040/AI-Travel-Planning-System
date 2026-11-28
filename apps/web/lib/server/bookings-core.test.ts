import { describe, expect, it } from "vitest";
import {
  BookingStoreError,
  addListItemAction,
  createListAction,
  deleteBookingAction,
  deleteListAction,
  deleteListItemAction,
  saveBookingAction,
  setListItemAssigneeAction,
  setListItemCheckedAction,
  type BookingDeps,
} from "./bookings-core";

// 決策 0010 B：預訂與清單的 Server Action。以使用者本人的 session 寫入（Viewer 與非成員由資料庫拒絕）；
// 時間以使用者選的時區換算；預約碼只存資料庫，不送 AI。

const TRIP = "8d2f0a6e-1c3b-4a5d-9e7f-1234567890ab";
const BOOKING = "a0000000-0000-4000-8000-000000000001";
const LIST = "a0000000-0000-4000-8000-000000000002";
const ITEM = "a0000000-0000-4000-8000-000000000003";
const A = "a0000000-0000-4000-8000-00000000000a";

function deps(over: Partial<BookingDeps> = {}) {
  const calls: unknown[][] = [];
  const logs: string[] = [];
  const d: BookingDeps = {
    getUser: async () => ({ id: A }),
    checkRateLimit: async () => true,
    saveBooking: async (tripId, id, data) => {
      calls.push(["save", tripId, id, data]);
      return id ?? BOOKING;
    },
    deleteBooking: async (tripId, id) => {
      calls.push(["delete", tripId, id]);
      return 1;
    },
    createList: async (tripId, kind, title) => {
      calls.push(["list", tripId, kind, title]);
      return LIST;
    },
    deleteList: async (tripId, id) => {
      calls.push(["deleteList", tripId, id]);
      return 1;
    },
    addListItem: async (tripId, listId, text, assignee) => {
      calls.push(["item", tripId, listId, text, assignee]);
      return ITEM;
    },
    updateListItem: async (tripId, id, fields) => {
      calls.push(["update", tripId, id, fields]);
      return 1;
    },
    deleteListItem: async (tripId, id) => {
      calls.push(["deleteItem", tripId, id]);
      return 1;
    },
    logError: (m) => logs.push(m),
    ...over,
  };
  return { d, calls, logs };
}

const form = (over: Record<string, unknown> = {}) => ({
  tripId: TRIP,
  bookingId: "",
  kind: "restaurant",
  title: " 壽司晚餐 ",
  startDate: "2027-01-10",
  startTime: "19:00",
  endDate: "",
  endTime: "20:30",
  timezone: "Asia/Tokyo",
  location: "銀座",
  confirmationCode: " ZX9QK2 ",
  note: "",
  itemId: "",
  ...over,
});

describe("saveBookingAction", () => {
  it("以選擇的時區換算開始與結束時間；結束只填時間時為同一天", async () => {
    const { d, calls } = deps();
    const r = await saveBookingAction(d, form());
    expect(r).toEqual({ ok: true, message: "已儲存預訂", id: BOOKING });
    expect(calls[0]).toEqual([
      "save",
      TRIP,
      null,
      {
        kind: "restaurant",
        title: "壽司晚餐",
        starts_at: "2027-01-10T10:00:00.000Z",
        ends_at: "2027-01-10T11:30:00.000Z",
        timezone: "Asia/Tokyo",
        location: "銀座",
        confirmation_code: "ZX9QK2",
        note: null,
        item_id: null,
      },
    ]);
  });

  it("跨日：結束填日期與時間；沒有結束時間時為 null", async () => {
    const { d, calls } = deps();
    await saveBookingAction(d, form({ kind: "flight", endDate: "2027-01-11", endTime: "06:00", timezone: "Asia/Taipei" }));
    expect(calls[0]?.[3]).toMatchObject({ starts_at: "2027-01-10T11:00:00.000Z", ends_at: "2027-01-10T22:00:00.000Z", timezone: "Asia/Taipei" });
    await saveBookingAction(d, form({ endTime: "", bookingId: BOOKING }));
    expect(calls[1]?.[2]).toBe(BOOKING);
    expect(calls[1]?.[3]).toMatchObject({ ends_at: null });
  });

  it.each([
    [{ title: "  " }, "請輸入標題"],
    [{ title: "長".repeat(81) }, "標題最多 80 字"],
    [{ kind: "boat" }, "請選擇類型"],
    [{ startTime: "" }, "請輸入開始日期與時間"],
    [{ endDate: "2027-01-11", endTime: "" }, "結束請填時間"],
    [{ endTime: "18:00" }, "結束不可早於開始"],
    [{ endDate: "2027-03-20" }, "預訂最長 60 天"],
    [{ timezone: "Mars/Base" }, "時區不正確"],
    [{ confirmationCode: "A".repeat(61) }, "預約碼最多 60 字"],
    [{ location: "長".repeat(201) }, "地點最多 200 字"],
    [{ note: "長".repeat(501) }, "備註最多 500 字"],
    [{ itemId: "not-a-uuid" }, "資料不正確，請重新檢查"],
  ])("輸入不正確 %o → %s", async (over, message) => {
    const { d, calls } = deps();
    expect(await saveBookingAction(d, form(over))).toEqual({ ok: false, message });
    expect(calls).toEqual([]);
  });

  it("需要登入、速率限制；Viewer 由資料庫拒絕；不記錄預約碼", async () => {
    expect(await saveBookingAction(deps({ getUser: async () => null }).d, form())).toEqual({ ok: false, message: "需要登入" });
    expect(await saveBookingAction(deps({ checkRateLimit: async () => false }).d, form())).toEqual({ ok: false, message: "操作過於頻繁，請稍後再試" });
    const forbidden = deps({
      saveBooking: async () => {
        throw new BookingStoreError("forbidden");
      },
    });
    expect(await saveBookingAction(forbidden.d, form())).toEqual({ ok: false, message: "只有 Owner 與 Companion 可以修改" });
    const broken = deps({
      saveBooking: async () => {
        throw new Error("ZX9QK2 db down");
      },
    });
    expect(await saveBookingAction(broken.d, form())).toEqual({ ok: false, message: "儲存失敗，請稍後再試" });
    expect(broken.logs.join("")).not.toContain("ZX9QK2");
  });
});

describe("deleteBookingAction", () => {
  it("刪除；沒有刪到時回報", async () => {
    const { d, calls } = deps();
    expect(await deleteBookingAction(d, TRIP, BOOKING)).toEqual({ ok: true, message: "已刪除預訂" });
    expect(calls[0]).toEqual(["delete", TRIP, BOOKING]);
    expect(await deleteBookingAction(deps({ deleteBooking: async () => 0 }).d, TRIP, BOOKING)).toEqual({ ok: false, message: "找不到這筆預訂，或你沒有權限" });
    expect(await deleteBookingAction(d, TRIP, "x")).toEqual({ ok: false, message: "資料不正確，請重新檢查" });
  });
});

describe("清單", () => {
  it("新增清單：沒有名稱時依類型命名", async () => {
    const { d, calls } = deps();
    expect(await createListAction(d, { tripId: TRIP, kind: "packing", title: "" })).toEqual({ ok: true, message: "已新增清單", id: LIST });
    await createListAction(d, { tripId: TRIP, kind: "todo", title: " 出發前 " });
    expect(calls).toEqual([
      ["list", TRIP, "packing", "打包"],
      ["list", TRIP, "todo", "出發前"],
    ]);
    expect(await createListAction(d, { tripId: TRIP, kind: "shopping", title: "" })).toEqual({ ok: false, message: "請選擇類型" });
    expect(await createListAction(d, { tripId: TRIP, kind: "todo", title: "長".repeat(41) })).toEqual({ ok: false, message: "名稱最多 40 字" });
  });

  it("新增項目、指定成員、勾選、刪除", async () => {
    const { d, calls } = deps();
    expect(await addListItemAction(d, { tripId: TRIP, listId: LIST, text: " 護照 ", assignee: A })).toEqual({ ok: true, message: "已新增", id: ITEM });
    expect(await addListItemAction(d, { tripId: TRIP, listId: LIST, text: "雨傘", assignee: "" })).toMatchObject({ ok: true });
    expect(await addListItemAction(d, { tripId: TRIP, listId: LIST, text: " ", assignee: "" })).toEqual({ ok: false, message: "請輸入項目" });
    expect(await addListItemAction(d, { tripId: TRIP, listId: LIST, text: "長".repeat(121), assignee: "" })).toEqual({ ok: false, message: "項目最多 120 字" });
    expect(await setListItemCheckedAction(d, TRIP, ITEM, true)).toEqual({ ok: true, message: "已完成" });
    expect(await setListItemCheckedAction(d, TRIP, ITEM, false)).toEqual({ ok: true, message: "已取消完成" });
    expect(await setListItemAssigneeAction(d, TRIP, ITEM, "")).toEqual({ ok: true, message: "已更新負責成員" });
    expect(await deleteListItemAction(d, TRIP, ITEM)).toEqual({ ok: true, message: "已刪除" });
    expect(await deleteListAction(d, TRIP, LIST)).toEqual({ ok: true, message: "已刪除清單" });
    expect(calls).toEqual([
      ["item", TRIP, LIST, "護照", A],
      ["item", TRIP, LIST, "雨傘", null],
      ["update", TRIP, ITEM, { checked: true }],
      ["update", TRIP, ITEM, { checked: false }],
      ["update", TRIP, ITEM, { assignee: null }],
      ["deleteItem", TRIP, ITEM],
      ["deleteList", TRIP, LIST],
    ]);
  });

  it("Viewer 修改時沒有更新任何資料列（RLS），指定非成員由資料庫拒絕", async () => {
    expect(await setListItemCheckedAction(deps({ updateListItem: async () => 0 }).d, TRIP, ITEM, true)).toEqual({ ok: false, message: "找不到這個項目，或你沒有權限" });
    const invalid = deps({
      addListItem: async () => {
        throw new BookingStoreError("invalid");
      },
    });
    expect(await addListItemAction(invalid.d, { tripId: TRIP, listId: LIST, text: "護照", assignee: A })).toEqual({ ok: false, message: "資料不正確，請重新檢查" });
  });
});
