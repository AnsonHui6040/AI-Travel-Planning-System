import "server-only";
import type { Expense, ExpenseCategory, Settlement } from "@atps/core";
import { uuid } from "@atps/schemas";
import { createLogger } from "@atps/security";
import { ExpenseStoreError, type ExpenseDeps } from "./expenses-core";
import { createSupabaseServerClient, supabaseGuardDeps } from "./supabase";

// 決策 0010 X：記帳以使用者本人的 session 讀寫（RLS：成員可讀，Owner、Companion 可寫，非成員看不到）。
// 花費與分攤只經 save_expense 寫入。不使用 service role，也不把花費資料送往 AI。

function storeError(code: string | undefined): ExpenseStoreError {
  if (code === "42501") return new ExpenseStoreError("forbidden");
  if (code === "22023" || code === "23514" || code === "22P02") return new ExpenseStoreError("invalid");
  if (code === "54000") return new ExpenseStoreError("limit");
  return new ExpenseStoreError("unknown");
}

export async function expenseActionDeps(): Promise<ExpenseDeps> {
  const guard = await supabaseGuardDeps();
  const session = await createSupabaseServerClient();
  const me = async () => (await guard.getUser())?.id ?? "";
  return {
    getUser: guard.getUser,
    checkRateLimit: guard.checkRateLimit,
    async saveExpense(tripId, expenseId, data) {
      const { data: id, error } = await session.rpc("save_expense", { p_trip: tripId, p_expense: expenseId, p_data: data });
      if (error || typeof id !== "string") throw storeError(error?.code);
      return id;
    },
    async deleteExpense(tripId, expenseId) {
      const { data, error } = await session.from("expenses").delete().eq("trip_id", tripId).eq("id", expenseId).select("id");
      if (error) throw storeError(error.code);
      return data.length;
    },
    // upsert 需要主鍵欄位的 UPDATE 權限；先更新，沒有資料列時再新增
    async setCurrency(tripId, currency) {
      const fields = { currency, updated_by: await me(), updated_at: new Date().toISOString() };
      const updated = await session.from("expense_settings").update(fields).eq("trip_id", tripId).select("trip_id");
      if (updated.error) throw storeError(updated.error.code);
      if (updated.data.length > 0) return;
      const { error } = await session.from("expense_settings").insert({ trip_id: tripId, currency, updated_by: fields.updated_by });
      if (error) throw storeError(error.code);
    },
    async saveRate(tripId, currency, rate) {
      const fields = { rate, updated_by: await me(), updated_at: new Date().toISOString() };
      const updated = await session.from("expense_rates").update(fields).eq("trip_id", tripId).eq("currency", currency).select("id");
      if (updated.error) throw storeError(updated.error.code);
      if (updated.data.length > 0) return;
      const { error } = await session.from("expense_rates").insert({ trip_id: tripId, currency, rate, updated_by: fields.updated_by });
      if (error) throw storeError(error.code);
    },
    async deleteRate(tripId, currency) {
      const { data, error } = await session.from("expense_rates").delete().eq("trip_id", tripId).eq("currency", currency).select("id");
      if (error) throw storeError(error.code);
      return data.length;
    },
    async recordSettlement(tripId, s) {
      const { error } = await session.from("expense_settlements").insert({
        trip_id: tripId,
        from_user: s.fromUser,
        to_user: s.toUser,
        amount: s.amount,
        currency: s.currency,
        paid_on: s.paidOn,
        recorded_by: await me(),
      });
      if (error) throw storeError(error.code);
    },
    async deleteSettlement(tripId, id) {
      const { data, error } = await session.from("expense_settlements").delete().eq("trip_id", tripId).eq("id", id).select("id");
      if (error) throw storeError(error.code);
      return data.length;
    },
    logError: (message) => createLogger().error(message),
  };
}

export interface ExpenseRecord extends Expense {
  spentOn: string;
  itemId: string | null;
  itemName: string | null;
  note: string | null;
  createdAt: string;
}

export interface SettlementRecord extends Settlement {
  id: string;
  paidOn: string;
}

export interface ExpenseMember {
  userId: string;
  name: string;
  isMe: boolean;
  // 目前仍是行程成員（已離開的成員只出現在舊的花費中）
  current: boolean;
}

export type ExpensesView =
  | { state: "signed_out" }
  | { state: "not_found" }
  | { state: "disabled" }
  | {
      state: "ok";
      tripId: string;
      tripName: string;
      canEdit: boolean;
      currency: string;
      currencySet: boolean;
      budget: { amount: number; currency: string } | null;
      rates: Record<string, number>;
      members: ExpenseMember[];
      expenses: ExpenseRecord[];
      settlements: SettlementRecord[];
      items: Array<{ id: string; name: string }>;
      today: string;
    };

const taipeiToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function readBudget(data: unknown): { amount: number; currency: string } | null {
  if (!data || typeof data !== "object") return null;
  const budget = (data as { budget?: unknown }).budget;
  if (!budget || typeof budget !== "object") return null;
  const { amount, currency } = budget as { amount?: unknown; currency?: unknown };
  return typeof amount === "number" && typeof currency === "string" ? { amount, currency } : null;
}

// F-05：功能開關 expense_ledger（只經 migration 修改）
export async function expenseLedgerEnabled(): Promise<boolean> {
  const session = await createSupabaseServerClient();
  const { data } = await session.from("feature_flags").select("enabled").eq("key", "expense_ledger").maybeSingle();
  return data?.enabled === true;
}

export async function loadExpenses(tripId: string): Promise<ExpensesView> {
  const session = await createSupabaseServerClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return { state: "signed_out" };
  if (!uuid.safeParse(tripId).success) return { state: "not_found" };
  const { data: trip } = await session.from("trips").select("name").eq("id", tripId).maybeSingle();
  if (!trip) return { state: "not_found" };
  if (!(await expenseLedgerEnabled())) return { state: "disabled" };
  const me = auth.user.id;

  const [membersRes, settingsRes, baselineRes, ratesRes, expensesRes, sharesRes, settlementsRes, itemsRes] = await Promise.all([
    session.from("trip_members").select("user_id, role, joined_at").eq("trip_id", tripId).order("joined_at").limit(100),
    session.from("expense_settings").select("currency").eq("trip_id", tripId).maybeSingle(),
    session.from("trip_baselines").select("data").eq("trip_id", tripId).eq("version", 1).maybeSingle(),
    session.from("expense_rates").select("currency, rate").eq("trip_id", tripId).order("currency"),
    session
      .from("expenses")
      .select("id, amount, currency, paid_by, spent_on, category, item_id, note, created_at")
      .eq("trip_id", tripId)
      .order("spent_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5000),
    session.from("expense_shares").select("expense_id, user_id, amount").eq("trip_id", tripId).limit(50000),
    session.from("expense_settlements").select("id, from_user, to_user, amount, currency, paid_on").eq("trip_id", tripId).order("paid_on").order("created_at").limit(1000),
    session.from("itinerary_items").select("id, name_zh").eq("trip_id", tripId).order("name_zh").limit(500),
  ]);
  if (membersRes.error || expensesRes.error || sharesRes.error || settlementsRes.error || ratesRes.error) throw new Error("讀取記帳資料失敗");

  const memberRows = membersRes.data ?? [];
  const myRole = memberRows.find((m) => m.user_id === me)?.role;
  const budget = readBudget(baselineRes.data?.data);
  const currency = String(settingsRes.data?.currency ?? budget?.currency ?? "TWD");
  const rates: Record<string, number> = {};
  for (const r of ratesRes.data ?? []) rates[String(r.currency)] = Number(r.rate);

  const sharesBy = new Map<string, Array<{ userId: string; amount: number }>>();
  for (const s of sharesRes.data ?? []) {
    const list = sharesBy.get(String(s.expense_id)) ?? [];
    list.push({ userId: String(s.user_id), amount: Number(s.amount) });
    sharesBy.set(String(s.expense_id), list);
  }
  const items = (itemsRes.data ?? []).map((i) => ({ id: String(i.id), name: String(i.name_zh) }));
  const itemName = new Map(items.map((i) => [i.id, i.name]));
  const memberOrder = new Map(memberRows.map((m, i) => [String(m.user_id), i]));
  const expenses: ExpenseRecord[] = (expensesRes.data ?? []).map((e) => ({
    id: String(e.id),
    amount: Number(e.amount),
    currency: String(e.currency),
    category: e.category as ExpenseCategory,
    paidBy: String(e.paid_by),
    // 分攤依成員順序排列（與平均分攤的餘數順序相同）
    shares: (sharesBy.get(String(e.id)) ?? []).sort((a, b) => (memberOrder.get(a.userId) ?? 999) - (memberOrder.get(b.userId) ?? 999)),
    spentOn: String(e.spent_on),
    itemId: e.item_id ? String(e.item_id) : null,
    itemName: e.item_id ? (itemName.get(String(e.item_id)) ?? null) : null,
    note: e.note ? String(e.note) : null,
    createdAt: String(e.created_at),
  }));
  const settlements: SettlementRecord[] = (settlementsRes.data ?? []).map((s) => ({
    id: String(s.id),
    fromUser: String(s.from_user),
    toUser: String(s.to_user),
    amount: Number(s.amount),
    currency: String(s.currency),
    paidOn: String(s.paid_on),
  }));

  // 名稱：目前成員與花費、結算中出現的人
  const ids = new Set(memberRows.map((m) => String(m.user_id)));
  for (const e of expenses) {
    ids.add(e.paidBy);
    for (const s of e.shares) ids.add(s.userId);
  }
  for (const s of settlements) {
    ids.add(s.fromUser);
    ids.add(s.toUser);
  }
  const { data: profiles } = await session.from("profiles").select("id, display_name").in("id", [...ids]);
  const nameOf = (id: string) => {
    const p = (profiles ?? []).find((x) => x.id === id);
    return p?.display_name ? String(p.display_name) : memberOrder.has(id) ? "未設定名稱的成員" : "已離開的成員";
  };
  const members: ExpenseMember[] = [...ids].map((userId) => ({ userId, name: nameOf(userId), isMe: userId === me, current: memberOrder.has(userId) }));
  members.sort((a, b) => (memberOrder.get(a.userId) ?? 999) - (memberOrder.get(b.userId) ?? 999));

  return {
    state: "ok",
    tripId,
    tripName: String(trip.name),
    canEdit: myRole === "owner" || myRole === "companion",
    currency,
    currencySet: Boolean(settingsRes.data),
    budget,
    rates,
    members,
    expenses,
    settlements,
    items,
    today: taipeiToday(),
  };
}
