import { describe, expect, it } from "vitest";
import { expenseCategory, expenseRateRow, expenseRow, expenseShareRow, expenseSettlementRow, tableSchemas } from "./index";

// 決策 0010 X：記帳資料表的 row schema（與 migration 20261128020000_x_expenses.sql 的 check constraint 相同）
const id = "00000000-0000-4000-8000-000000000001";
const at = "2026-12-01T10:00:00+00:00";
const row = {
  id,
  trip_id: id,
  amount: 1500,
  currency: "JPY",
  paid_by: id,
  spent_on: "2026-12-01",
  category: "food",
  item_id: null,
  note: null,
  created_by: id,
  created_at: at,
  updated_at: at,
};

describe("記帳 row schema", () => {
  it("五張資料表都登記在 tableSchemas", () => {
    expect(Object.keys(tableSchemas)).toEqual(expect.arrayContaining(["expense_settings", "expense_rates", "expenses", "expense_shares", "expense_settlements"]));
  });

  it("花費金額大於零、不超過 10,000,000，拒絕未知欄位", () => {
    expect(expenseRow.safeParse(row).success).toBe(true);
    expect(expenseRow.safeParse({ ...row, amount: 0 }).success).toBe(false);
    expect(expenseRow.safeParse({ ...row, amount: 10_000_001 }).success).toBe(false);
    expect(expenseRow.safeParse({ ...row, extra: 1 }).success).toBe(false);
  });

  it("類別只有六種；幣別為三個大寫字母", () => {
    expect(expenseCategory.options).toEqual(["food", "transport", "lodging", "tickets", "shopping", "other"]);
    expect(expenseRow.safeParse({ ...row, currency: "jpy" }).success).toBe(false);
  });

  it("分攤可為 0 但不可為負；匯率必須大於零；結算金額大於零", () => {
    expect(expenseShareRow.safeParse({ expense_id: id, trip_id: id, user_id: id, amount: 0 }).success).toBe(true);
    expect(expenseShareRow.safeParse({ expense_id: id, trip_id: id, user_id: id, amount: -1 }).success).toBe(false);
    expect(expenseRateRow.safeParse({ id, trip_id: id, currency: "USD", rate: 0, updated_by: id, updated_at: at }).success).toBe(false);
    const settlement = { id, trip_id: id, from_user: id, to_user: id, amount: 0, currency: "TWD", paid_on: "2026-12-03", recorded_by: id, created_at: at };
    expect(expenseSettlementRow.safeParse(settlement).success).toBe(false);
  });
});
