"use server";

import { revalidatePath } from "next/cache";
import {
  deleteExpenseAction,
  deleteRateAction,
  deleteSettlementAction,
  recordSettlementAction,
  saveExpenseAction,
  saveRateAction,
  setCurrencyAction,
  type ExpenseActionResult,
} from "../../../../lib/server/expenses-core";
import { expenseActionDeps, loadExpenses } from "../../../../lib/server/expenses";

// 決策 0010 X：記帳。Next.js 對 Server Action 比對 Origin 與 Host；登入與速率限制在 expenses-core 內檢查（C-11）

const refresh = (tripId: unknown, result: ExpenseActionResult) => {
  if (result.ok && typeof tripId === "string") revalidatePath(`/trips/${tripId}/expenses`, "layout");
  return result;
};

const tripOf = (input: unknown) => (input && typeof input === "object" ? (input as { tripId?: unknown }).tripId : undefined);

export async function saveExpense(input: unknown): Promise<ExpenseActionResult> {
  return refresh(tripOf(input), await saveExpenseAction(await expenseActionDeps(), input));
}

export async function deleteExpense(tripId: string, expenseId: string): Promise<ExpenseActionResult> {
  return refresh(tripId, await deleteExpenseAction(await expenseActionDeps(), tripId, expenseId));
}

export async function recordSettlement(input: unknown): Promise<ExpenseActionResult> {
  return refresh(tripOf(input), await recordSettlementAction(await expenseActionDeps(), input));
}

export async function deleteSettlement(tripId: string, settlementId: string): Promise<ExpenseActionResult> {
  return refresh(tripId, await deleteSettlementAction(await expenseActionDeps(), tripId, settlementId));
}

export async function setCurrency(_previous: ExpenseActionResult | null, form: FormData): Promise<ExpenseActionResult> {
  const tripId = form.get("tripId");
  return refresh(tripId, await setCurrencyAction(await expenseActionDeps(), tripId, form.get("currency")));
}

export async function saveRate(_previous: ExpenseActionResult | null, form: FormData): Promise<ExpenseActionResult> {
  const tripId = form.get("tripId");
  // 主幣別以伺服器讀到的設定為準
  const view = typeof tripId === "string" ? await loadExpenses(tripId) : null;
  const tripCurrency = view?.state === "ok" ? view.currency : "";
  return refresh(tripId, await saveRateAction(await expenseActionDeps(), tripId, tripCurrency, form.get("currency"), form.get("rate")));
}

export async function deleteRate(tripId: string, currency: string): Promise<ExpenseActionResult> {
  return refresh(tripId, await deleteRateAction(await expenseActionDeps(), tripId, currency));
}
