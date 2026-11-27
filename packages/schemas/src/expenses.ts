import { z } from "zod";
import { LIMITS, currencyCode, isoDate, offsetDateTime, text, uuid } from "./common";

// 決策 0010 X：記帳與分帳的資料表。鍵名與 migration 20261128200000_x_expenses.sql 的欄位一致
// （tooling/schema-migration-consistency.test.ts）。金額上限與 money 相同；匯率為 1 單位外幣 = rate 單位主幣別。

export const expenseCategory = z.enum(["food", "transport", "lodging", "tickets", "shopping", "other"]);

const positiveAmount = z.number().positive().max(LIMITS.money.max);
const shareAmount = z.number().min(0).max(LIMITS.money.max);

export const expenseSettingsRow = z.strictObject({
  trip_id: uuid,
  currency: currencyCode,
  updated_by: uuid,
  updated_at: offsetDateTime,
});

export const expenseRateRow = z.strictObject({
  id: uuid,
  trip_id: uuid,
  currency: currencyCode,
  rate: z.number().positive().max(1_000_000),
  updated_by: uuid,
  updated_at: offsetDateTime,
});

export const expenseRow = z.strictObject({
  id: uuid,
  trip_id: uuid,
  amount: positiveAmount,
  currency: currencyCode,
  paid_by: uuid,
  spent_on: isoDate,
  category: expenseCategory,
  item_id: uuid.nullable(),
  note: text(LIMITS.shortNote).nullable(),
  created_by: uuid,
  created_at: offsetDateTime,
  updated_at: offsetDateTime,
});

export const expenseShareRow = z.strictObject({
  expense_id: uuid,
  trip_id: uuid,
  user_id: uuid,
  amount: shareAmount,
});

export const expenseSettlementRow = z.strictObject({
  id: uuid,
  trip_id: uuid,
  from_user: uuid,
  to_user: uuid,
  amount: positiveAmount,
  currency: currencyCode,
  paid_on: isoDate,
  recorded_by: uuid,
  created_at: offsetDateTime,
});
