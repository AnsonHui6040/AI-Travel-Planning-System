import { describe, expect, it } from "vitest";
import {
  ExpenseStoreError,
  deleteExpenseAction,
  deleteRateAction,
  deleteSettlementAction,
  recordSettlementAction,
  saveExpenseAction,
  saveRateAction,
  setCurrencyAction,
  type ExpenseDeps,
} from "./expenses-core";

// 決策 0010 X：記帳的 Server Action。分攤在伺服器以 core 計算與檢查（資料庫 save_expense 再檢查一次）；
// Viewer 與非成員由資料庫拒絕（42501）；花費資料不經 AI。

const TRIP = "8d2f0a6e-1c3b-4a5d-9e7f-1234567890ab";
const EXP = "a0000000-0000-4000-8000-000000000001";
const A = "a0000000-0000-4000-8000-00000000000a";
const B = "a0000000-0000-4000-8000-00000000000b";
const C = "a0000000-0000-4000-8000-00000000000c";

function deps(over: Partial<ExpenseDeps> = {}) {
  const calls: unknown[][] = [];
  const logs: string[] = [];
  const d: ExpenseDeps = {
    getUser: async () => ({ id: A }),
    checkRateLimit: async () => true,
    saveExpense: async (tripId, id, data) => {
      calls.push(["save", tripId, id, data]);
      return id ?? EXP;
    },
    deleteExpense: async (tripId, id) => {
      calls.push(["delete", tripId, id]);
      return 1;
    },
    setCurrency: async (tripId, currency) => {
      calls.push(["currency", tripId, currency]);
    },
    saveRate: async (tripId, currency, rate) => {
      calls.push(["rate", tripId, currency, rate]);
    },
    deleteRate: async (tripId, currency) => {
      calls.push(["deleteRate", tripId, currency]);
      return 1;
    },
    recordSettlement: async (tripId, s) => {
      calls.push(["settle", tripId, s]);
    },
    deleteSettlement: async (tripId, id) => {
      calls.push(["deleteSettlement", tripId, id]);
      return 1;
    },
    logError: (m) => logs.push(m),
    ...over,
  };
  return { d, calls, logs };
}

const input = (over: Record<string, unknown> = {}) => ({
  tripId: TRIP,
  expenseId: null,
  amount: "1000",
  currency: "TWD",
  paidBy: A,
  spentOn: "2026-12-01",
  category: "food",
  itemId: "",
  note: " 晚餐 ",
  split: "equal",
  members: [A, B, C],
  custom: {},
  ...over,
});

describe("saveExpenseAction", () => {
  it("平均分攤：以 core 計算每人金額，餘數給前面的成員", async () => {
    const { d, calls } = deps();
    expect(await saveExpenseAction(d, input())).toEqual({ ok: true, message: "已儲存花費", id: EXP });
    expect(calls).toEqual([
      [
        "save",
        TRIP,
        null,
        {
          amount: 1000,
          currency: "TWD",
          paid_by: A,
          spent_on: "2026-12-01",
          category: "food",
          item_id: null,
          note: "晚餐",
          shares: [
            { user_id: A, amount: 334 },
            { user_id: B, amount: 333 },
            { user_id: C, amount: 333 },
          ],
        },
      ],
    ]);
  });

  it("自訂分攤：只計入勾選的成員；總和不等於金額時說明差額，不寫入", async () => {
    const { d, calls } = deps();
    const result = await saveExpenseAction(d, input({ split: "custom", members: [A, B], custom: { [A]: "600", [B]: "300", [C]: "100" } }));
    expect(result).toEqual({ ok: false, message: "分攤總和與金額相差 100 TWD" });
    expect(calls).toEqual([]);
    const ok = await saveExpenseAction(d, input({ split: "custom", members: [A, B], custom: { [A]: "600", [B]: "400" }, expenseId: EXP }));
    expect(ok.ok).toBe(true);
    expect((calls[0]?.[3] as { shares: unknown }).shares).toEqual([
      { user_id: A, amount: 600 },
      { user_id: B, amount: 400 },
    ]);
    expect(calls[0]?.[2]).toBe(EXP);
  });

  it.each([
    [{ amount: "0" }, "金額須大於 0"],
    [{ amount: "abc" }, "金額須大於 0"],
    [{ amount: "10.5", currency: "JPY" }, "JPY 不用小數"],
    [{ amount: "10.555", currency: "USD" }, "USD 最多 2 位小數"],
    [{ members: [] }, "至少選一位分攤成員"],
    [{ currency: "jp" }, "幣別須為三個英文字母"],
    [{ spentOn: "12/01" }, "請選擇日期"],
    [{ category: "gift" }, "請選擇類別"],
    [{ note: "x".repeat(201) }, "備註最多 200 字"],
  ])("輸入錯誤時不寫入：%o", async (over, message) => {
    const { d, calls } = deps();
    expect(await saveExpenseAction(d, input(over))).toEqual({ ok: false, message });
    expect(calls).toEqual([]);
  });

  it("幣別轉為大寫；未登入、速率限制、Viewer（資料庫拒絕）時說明原因", async () => {
    const { d, calls } = deps();
    await saveExpenseAction(d, input({ currency: "usd", amount: "12.5" }));
    expect((calls[0]?.[3] as { currency: string }).currency).toBe("USD");
    expect(await saveExpenseAction(deps({ getUser: async () => null }).d, input())).toEqual({ ok: false, message: "需要登入" });
    expect(await saveExpenseAction(deps({ checkRateLimit: async () => false }).d, input())).toEqual({ ok: false, message: "操作過於頻繁，請稍後再試" });
    const forbidden = deps({
      saveExpense: async () => {
        throw new ExpenseStoreError("forbidden");
      },
    });
    expect(await saveExpenseAction(forbidden.d, input())).toEqual({ ok: false, message: "只有 Owner 與 Companion 可以記帳" });
    const broken = deps({
      saveExpense: async () => {
        throw new Error("db down");
      },
    });
    expect(await saveExpenseAction(broken.d, input())).toEqual({ ok: false, message: "儲存失敗，請稍後再試" });
    expect(broken.logs).toEqual(["記帳寫入失敗"]);
  });
});

describe("deleteExpenseAction", () => {
  it("刪除一筆花費；沒有刪到資料（Viewer）時說明", async () => {
    const { d, calls } = deps();
    expect(await deleteExpenseAction(d, TRIP, EXP)).toEqual({ ok: true, message: "已刪除花費" });
    expect(calls).toEqual([["delete", TRIP, EXP]]);
    expect(await deleteExpenseAction(deps({ deleteExpense: async () => 0 }).d, TRIP, EXP)).toEqual({ ok: false, message: "只有 Owner 與 Companion 可以記帳" });
    expect(await deleteExpenseAction(d, TRIP, "x")).toEqual({ ok: false, message: "找不到這筆花費" });
  });
});

describe("主幣別與匯率", () => {
  it("設定主幣別", async () => {
    const { d, calls } = deps();
    expect(await setCurrencyAction(d, TRIP, "jpy")).toEqual({ ok: true, message: "主幣別為 JPY" });
    expect(calls).toEqual([["currency", TRIP, "JPY"]]);
    expect(await setCurrencyAction(d, TRIP, "JP")).toEqual({ ok: false, message: "幣別須為三個英文字母" });
  });

  it("匯率必須大於 0；主幣別本身不需要匯率", async () => {
    const { d, calls } = deps();
    expect(await saveRateAction(d, TRIP, "TWD", "jpy", "0.213")).toEqual({ ok: true, message: "已儲存 1 JPY = 0.213 TWD" });
    expect(calls).toEqual([["rate", TRIP, "JPY", 0.213]]);
    expect(await saveRateAction(d, TRIP, "TWD", "USD", "0")).toEqual({ ok: false, message: "匯率須大於 0" });
    expect(await saveRateAction(d, TRIP, "TWD", "TWD", "1")).toEqual({ ok: false, message: "主幣別不需要匯率" });
    expect(await deleteRateAction(d, TRIP, "JPY")).toEqual({ ok: true, message: "已刪除 JPY 的匯率" });
  });
});

describe("結算", () => {
  it("標記已付款：金額依幣別四捨五入檢查、雙方不同、日期必填", async () => {
    const { d, calls } = deps();
    const s = { tripId: TRIP, fromUser: B, toUser: A, amount: "333", currency: "TWD", paidOn: "2026-12-03" };
    expect(await recordSettlementAction(d, s)).toEqual({ ok: true, message: "已標記為已付款" });
    expect(calls).toEqual([["settle", TRIP, { fromUser: B, toUser: A, amount: 333, currency: "TWD", paidOn: "2026-12-03" }]]);
    expect(await recordSettlementAction(d, { ...s, toUser: B })).toEqual({ ok: false, message: "付款人與收款人不可相同" });
    expect(await recordSettlementAction(d, { ...s, amount: "3.5" })).toEqual({ ok: false, message: "TWD 不用小數" });
    expect(await recordSettlementAction(d, { ...s, paidOn: "" })).toEqual({ ok: false, message: "請選擇付款日期" });
  });

  it("取消已付款", async () => {
    const { d, calls } = deps();
    expect(await deleteSettlementAction(d, TRIP, EXP)).toEqual({ ok: true, message: "已取消這筆付款紀錄" });
    expect(calls).toEqual([["deleteSettlement", TRIP, EXP]]);
  });
});
