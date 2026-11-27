import { currencyDecimals, splitEqually, validateShares, type Share } from "@atps/core";
import { expenseCategory, isoDate, uuid } from "@atps/schemas";
import { z } from "zod";

// 決策 0010 X：記帳的 Server Action 邏輯。以使用者本人的 session 寫入（Viewer 與非成員由資料庫拒絕）；
// 分攤以 core 計算與檢查，資料庫 save_expense 再檢查一次。花費資料不經 AI。

export class ExpenseStoreError extends Error {
  constructor(readonly reason: "forbidden" | "invalid" | "limit" | "unknown") {
    super(`記帳寫入失敗（${reason}）`);
  }
}

export interface ExpenseWrite {
  amount: number;
  currency: string;
  paid_by: string;
  spent_on: string;
  category: z.infer<typeof expenseCategory>;
  item_id: string | null;
  note: string | null;
  shares: Array<{ user_id: string; amount: number }>;
}

export interface SettlementWrite {
  fromUser: string;
  toUser: string;
  amount: number;
  currency: string;
  paidOn: string;
}

export interface ExpenseDeps {
  getUser: () => Promise<{ id: string } | null>;
  checkRateLimit: (endpoint: string, limit: number, windowSeconds: number) => Promise<boolean>;
  saveExpense: (tripId: string, expenseId: string | null, data: ExpenseWrite) => Promise<string>;
  deleteExpense: (tripId: string, expenseId: string) => Promise<number>;
  setCurrency: (tripId: string, currency: string) => Promise<void>;
  saveRate: (tripId: string, currency: string, rate: number) => Promise<void>;
  deleteRate: (tripId: string, currency: string) => Promise<number>;
  recordSettlement: (tripId: string, settlement: SettlementWrite) => Promise<void>;
  deleteSettlement: (tripId: string, settlementId: string) => Promise<number>;
  logError: (message: string) => void;
}

export interface ExpenseActionResult {
  ok: boolean;
  message: string;
  id?: string;
}

const RATE = { endpoint: "expense.write", limit: 60, windowSeconds: 60 } as const;
const FORBIDDEN = "只有 Owner 與 Companion 可以記帳";

async function guard(deps: ExpenseDeps): Promise<ExpenseActionResult | null> {
  if (!(await deps.getUser())) return { ok: false, message: "需要登入" };
  if (!(await deps.checkRateLimit(RATE.endpoint, RATE.limit, RATE.windowSeconds))) return { ok: false, message: "操作過於頻繁，請稍後再試" };
  return null;
}

function storeMessage(error: unknown, deps: ExpenseDeps): ExpenseActionResult {
  if (error instanceof ExpenseStoreError && error.reason === "forbidden") return { ok: false, message: FORBIDDEN };
  if (error instanceof ExpenseStoreError && error.reason === "invalid") return { ok: false, message: "資料不正確，請重新檢查" };
  if (error instanceof ExpenseStoreError && error.reason === "limit") return { ok: false, message: "已達筆數上限" };
  deps.logError("記帳寫入失敗");
  return { ok: false, message: "儲存失敗，請稍後再試" };
}

const currencyText = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/));

// 金額文字：大於 0，符合幣別小數位數
function parseAmount(raw: unknown, currency: string, allowZero = false): number | string {
  const text = typeof raw === "string" ? raw.trim().replace(/,/g, "") : "";
  const value = /^\d+(\.\d+)?$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) return "金額須大於 0";
  if (value > 10_000_000) return "金額不可超過 10,000,000";
  const decimals = (text.split(".")[1] ?? "").length;
  const max = currencyDecimals(currency);
  if (decimals > max) return max === 0 ? `${currency} 不用小數` : `${currency} 最多 ${max} 位小數`;
  return value;
}

const expenseForm = z.object({
  tripId: uuid,
  expenseId: z.preprocess((v) => (v === "" || v === undefined ? null : v), uuid.nullable()),
  amount: z.unknown(),
  currency: z.unknown(),
  paidBy: uuid,
  spentOn: z.unknown(),
  category: z.unknown(),
  itemId: z.preprocess((v) => (v === "" || v === undefined ? null : v), uuid.nullable()),
  note: z.unknown(),
  split: z.enum(["equal", "custom"]),
  members: z.array(uuid).max(50),
  custom: z.record(z.string(), z.unknown()),
});

export async function saveExpenseAction(deps: ExpenseDeps, raw: unknown): Promise<ExpenseActionResult> {
  const denied = await guard(deps);
  if (denied) return denied;
  const parsed = expenseForm.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "資料不正確，請重新檢查" };
  const f = parsed.data;
  const currency = currencyText.safeParse(f.currency);
  if (!currency.success) return { ok: false, message: "幣別須為三個英文字母" };
  const amount = parseAmount(f.amount, currency.data);
  if (typeof amount === "string") return { ok: false, message: amount };
  if (!isoDate.safeParse(f.spentOn).success) return { ok: false, message: "請選擇日期" };
  const category = expenseCategory.safeParse(f.category);
  if (!category.success) return { ok: false, message: "請選擇類別" };
  const note = typeof f.note === "string" ? f.note.trim() : "";
  if (note.length > 200) return { ok: false, message: "備註最多 200 字" };
  const members = [...new Set(f.members)];
  if (members.length === 0) return { ok: false, message: "至少選一位分攤成員" };

  let shares: Share[];
  if (f.split === "equal") {
    shares = splitEqually(amount, currency.data, members);
  } else {
    shares = [];
    for (const userId of members) {
      const share = parseAmount(f.custom[userId] ?? "0", currency.data, true);
      if (typeof share === "string") return { ok: false, message: share === "金額須大於 0" ? "分攤金額不可為負" : share };
      shares.push({ userId, amount: share });
    }
  }
  const check = validateShares(amount, currency.data, shares);
  if (!check.ok) {
    if (check.reason === "sum_mismatch") return { ok: false, message: `分攤總和與金額相差 ${Math.abs(check.difference)} ${currency.data}` };
    return { ok: false, message: "分攤金額不正確" };
  }
  try {
    const id = await deps.saveExpense(f.tripId, f.expenseId, {
      amount,
      currency: currency.data,
      paid_by: f.paidBy,
      spent_on: f.spentOn as string,
      category: category.data,
      item_id: f.itemId,
      note: note === "" ? null : note,
      shares: shares.map((s) => ({ user_id: s.userId, amount: s.amount })),
    });
    return { ok: true, message: "已儲存花費", id };
  } catch (error) {
    return storeMessage(error, deps);
  }
}

export async function deleteExpenseAction(deps: ExpenseDeps, tripId: unknown, expenseId: unknown): Promise<ExpenseActionResult> {
  const denied = await guard(deps);
  if (denied) return denied;
  if (!uuid.safeParse(tripId).success || !uuid.safeParse(expenseId).success) return { ok: false, message: "找不到這筆花費" };
  try {
    const count = await deps.deleteExpense(tripId as string, expenseId as string);
    return count > 0 ? { ok: true, message: "已刪除花費" } : { ok: false, message: FORBIDDEN };
  } catch (error) {
    return storeMessage(error, deps);
  }
}

export async function setCurrencyAction(deps: ExpenseDeps, tripId: unknown, raw: unknown): Promise<ExpenseActionResult> {
  const denied = await guard(deps);
  if (denied) return denied;
  if (!uuid.safeParse(tripId).success) return { ok: false, message: "找不到這個行程" };
  const currency = currencyText.safeParse(raw);
  if (!currency.success) return { ok: false, message: "幣別須為三個英文字母" };
  try {
    await deps.setCurrency(tripId as string, currency.data);
    return { ok: true, message: `主幣別為 ${currency.data}` };
  } catch (error) {
    return storeMessage(error, deps);
  }
}

export async function saveRateAction(deps: ExpenseDeps, tripId: unknown, tripCurrency: string, rawCurrency: unknown, rawRate: unknown): Promise<ExpenseActionResult> {
  const denied = await guard(deps);
  if (denied) return denied;
  if (!uuid.safeParse(tripId).success) return { ok: false, message: "找不到這個行程" };
  const currency = currencyText.safeParse(rawCurrency);
  if (!currency.success) return { ok: false, message: "幣別須為三個英文字母" };
  if (currency.data === tripCurrency) return { ok: false, message: "主幣別不需要匯率" };
  const text = typeof rawRate === "string" ? rawRate.trim() : "";
  const rate = /^\d+(\.\d{1,8})?$/.test(text) ? Number(text) : Number.NaN;
  if (!(rate > 0) || rate > 1_000_000) return { ok: false, message: "匯率須大於 0" };
  try {
    await deps.saveRate(tripId as string, currency.data, rate);
    return { ok: true, message: `已儲存 1 ${currency.data} = ${rate} ${tripCurrency}` };
  } catch (error) {
    return storeMessage(error, deps);
  }
}

export async function deleteRateAction(deps: ExpenseDeps, tripId: unknown, rawCurrency: unknown): Promise<ExpenseActionResult> {
  const denied = await guard(deps);
  if (denied) return denied;
  const currency = currencyText.safeParse(rawCurrency);
  if (!uuid.safeParse(tripId).success || !currency.success) return { ok: false, message: "找不到這個匯率" };
  try {
    const count = await deps.deleteRate(tripId as string, currency.data);
    return count > 0 ? { ok: true, message: `已刪除 ${currency.data} 的匯率` } : { ok: false, message: FORBIDDEN };
  } catch (error) {
    return storeMessage(error, deps);
  }
}

const settlementForm = z.object({ tripId: uuid, fromUser: uuid, toUser: uuid, amount: z.unknown(), currency: z.unknown(), paidOn: z.unknown() });

export async function recordSettlementAction(deps: ExpenseDeps, raw: unknown): Promise<ExpenseActionResult> {
  const denied = await guard(deps);
  if (denied) return denied;
  const parsed = settlementForm.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "資料不正確，請重新檢查" };
  const f = parsed.data;
  if (f.fromUser === f.toUser) return { ok: false, message: "付款人與收款人不可相同" };
  const currency = currencyText.safeParse(f.currency);
  if (!currency.success) return { ok: false, message: "幣別須為三個英文字母" };
  const amount = parseAmount(f.amount, currency.data);
  if (typeof amount === "string") return { ok: false, message: amount };
  if (!isoDate.safeParse(f.paidOn).success) return { ok: false, message: "請選擇付款日期" };
  try {
    await deps.recordSettlement(f.tripId, { fromUser: f.fromUser, toUser: f.toUser, amount, currency: currency.data, paidOn: f.paidOn as string });
    return { ok: true, message: "已標記為已付款" };
  } catch (error) {
    return storeMessage(error, deps);
  }
}

export async function deleteSettlementAction(deps: ExpenseDeps, tripId: unknown, settlementId: unknown): Promise<ExpenseActionResult> {
  const denied = await guard(deps);
  if (denied) return denied;
  if (!uuid.safeParse(tripId).success || !uuid.safeParse(settlementId).success) return { ok: false, message: "找不到這筆付款紀錄" };
  try {
    const count = await deps.deleteSettlement(tripId as string, settlementId as string);
    return count > 0 ? { ok: true, message: "已取消這筆付款紀錄" } : { ok: false, message: FORBIDDEN };
  } catch (error) {
    return storeMessage(error, deps);
  }
}

