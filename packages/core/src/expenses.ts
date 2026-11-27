// 決策 0010 X：記帳與分帳的計算（純函式）。
// 金額以幣別的最小單位（整數）計算，避免浮點誤差；回傳值為一般單位（例如 USD 的 12.34）。
// 匯率由使用者輸入：1 單位外幣 = rate 單位主幣別；沒有匯率的花費不計入，也不猜測（不呼叫外部匯率服務）。
// 花費資料不送 AI：本模組只在伺服器與瀏覽器端計算畫面上的數字。

export const EXPENSE_CATEGORIES = ["food", "transport", "lodging", "tickets", "shopping", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

// ISO 4217 的小數位數；TWD 依台灣日常使用不用小數（與資料庫 private.currency_decimals 相同）
const ZERO_DECIMALS = new Set(["TWD", "JPY", "KRW", "VND", "IDR", "CLP", "ISK", "HUF"]);
const THREE_DECIMALS = new Set(["BHD", "KWD", "OMR", "JOD", "TND"]);

export function currencyDecimals(currency: string): number {
  if (ZERO_DECIMALS.has(currency)) return 0;
  if (THREE_DECIMALS.has(currency)) return 3;
  return 2;
}

// 以十進位字串移動小數點，避免 1.005 * 100 = 100.49999… 的誤差
function shift(value: number, digits: number): number {
  const s = String(Math.abs(value));
  return s.includes("e") ? Math.abs(value) * 10 ** digits : Number(`${s}e${digits}`);
}

const roundHalfUp = (value: number) => Math.sign(value) * Math.round(Math.abs(value) + 1e-9);

export function toMinor(amount: number, currency: string): number {
  return Math.sign(amount) * Math.round(shift(amount, currencyDecimals(currency)));
}

export function fromMinor(minor: number, currency: string): number {
  const d = currencyDecimals(currency);
  return d === 0 ? minor : Number((minor / 10 ** d).toFixed(d));
}

export function roundMoney(amount: number, currency: string): number {
  return fromMinor(toMinor(amount, currency), currency);
}

const isWhole = (amount: number, currency: string) => Math.abs(shift(amount, currencyDecimals(currency)) - toMinor(Math.abs(amount), currency)) < 1e-6;

export type Rates = Readonly<Record<string, number>>;

// 換算為主幣別的最小單位；沒有匯率時為 null
function convertMinor(amount: number, from: string, to: string, rates: Rates): number | null {
  if (from === to) return toMinor(amount, to);
  const rate = rates[from];
  if (rate === undefined || !(rate > 0)) return null;
  return roundHalfUp(toMinor(amount, from) * rate * 10 ** (currencyDecimals(to) - currencyDecimals(from)));
}

export function convertAmount(amount: number, from: string, to: string, rates: Rates): number | null {
  const minor = convertMinor(amount, from, to, rates);
  return minor === null ? null : fromMinor(minor, to);
}

export interface Share {
  userId: string;
  amount: number;
}

export interface Expense {
  id: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  paidBy: string;
  shares: readonly Share[];
}

export interface Settlement {
  fromUser: string;
  toUser: string;
  amount: number;
  currency: string;
}

// 平均分攤：除不盡的最小單位依成員順序每人多分一個
export function splitEqually(amount: number, currency: string, members: readonly string[]): Share[] {
  const ids = [...new Set(members)];
  if (ids.length === 0) return [];
  const total = toMinor(amount, currency);
  const base = Math.floor(total / ids.length);
  const extra = total - base * ids.length;
  return ids.map((userId, i) => ({ userId, amount: fromMinor(base + (i < extra ? 1 : 0), currency) }));
}

export type ShareCheck =
  | { ok: true }
  | { ok: false; reason: "amount" | "empty" | "duplicate" | "negative" | "precision" }
  | { ok: false; reason: "sum_mismatch"; difference: number };

// 自訂分攤：每人金額不為負、符合幣別小數位數，總和等於花費金額（資料庫 save_expense 再檢查一次）
export function validateShares(amount: number, currency: string, shares: readonly Share[]): ShareCheck {
  if (!(amount > 0) || !isWhole(amount, currency)) return { ok: false, reason: "amount" };
  if (shares.length === 0) return { ok: false, reason: "empty" };
  if (new Set(shares.map((s) => s.userId)).size !== shares.length) return { ok: false, reason: "duplicate" };
  if (shares.some((s) => s.amount < 0 || !Number.isFinite(s.amount))) return { ok: false, reason: "negative" };
  if (shares.some((s) => !isWhole(s.amount, currency))) return { ok: false, reason: "precision" };
  const diff = toMinor(amount, currency) - shares.reduce((sum, s) => sum + toMinor(s.amount, currency), 0);
  return diff === 0 ? { ok: true } : { ok: false, reason: "sum_mismatch", difference: fromMinor(diff, currency) };
}

export interface ExpenseTotals {
  total: number;
  byCategory: Array<{ category: ExpenseCategory; amount: number }>;
  // 缺匯率而未計入的幣別（字母順序）與筆數
  missingRates: string[];
  excludedCount: number;
}

export function expenseTotals(input: { tripCurrency: string; rates: Rates; expenses: readonly Expense[] }): ExpenseTotals {
  const sums = new Map<ExpenseCategory, number>(EXPENSE_CATEGORIES.map((c) => [c, 0]));
  const missing = new Set<string>();
  let excluded = 0;
  for (const e of input.expenses) {
    const minor = convertMinor(e.amount, e.currency, input.tripCurrency, input.rates);
    if (minor === null) {
      missing.add(e.currency);
      excluded += 1;
      continue;
    }
    sums.set(e.category, (sums.get(e.category) ?? 0) + minor);
  }
  const total = [...sums.values()].reduce((a, b) => a + b, 0);
  return {
    total: fromMinor(total, input.tripCurrency),
    byCategory: EXPENSE_CATEGORIES.map((category) => ({ category, amount: fromMinor(sums.get(category) ?? 0, input.tripCurrency) })),
    missingRates: [...missing].sort(),
    excludedCount: excluded,
  };
}

export type BudgetStatus =
  | { state: "none" }
  | { state: "no_rate"; currency: string }
  | { state: "within" | "over"; budget: number; remaining: number; usedPercent: number };

// 與旅行基線的預算比較（以主幣別）
export function budgetStatus(input: { total: number; tripCurrency: string; budget: { amount: number; currency: string } | null; rates: Rates }): BudgetStatus {
  if (!input.budget) return { state: "none" };
  const budgetMinor = convertMinor(input.budget.amount, input.budget.currency, input.tripCurrency, input.rates);
  if (budgetMinor === null) return { state: "no_rate", currency: input.budget.currency };
  const totalMinor = toMinor(input.total, input.tripCurrency);
  const remaining = budgetMinor - totalMinor;
  const usedPercent = budgetMinor > 0 ? Math.round((totalMinor / budgetMinor) * 100) : totalMinor > 0 ? 100 : 0;
  return {
    state: remaining < 0 ? "over" : "within",
    budget: fromMinor(budgetMinor, input.tripCurrency),
    remaining: fromMinor(remaining, input.tripCurrency),
    usedPercent,
  };
}

export interface Balance {
  userId: string;
  paid: number;
  share: number;
  // 正數為應收，負數為應付
  net: number;
}

// 以最大餘數法把已換算的總額依原幣別分攤比例分配，合計等於總額
function apportion(totalMinor: number, shares: readonly Share[], currency: string): number[] {
  const weights = shares.map((s) => toMinor(s.amount, currency));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (totalMinor * w) / weightSum);
  const floors = exact.map((x) => Math.floor(x + 1e-9));
  const left = totalMinor - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - (floors[i] ?? 0) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  const extra = new Set(order.slice(0, Math.max(0, left)).map((o) => o.i));
  return floors.map((f, i) => f + (extra.has(i) ? 1 : 0));
}

export function expenseBalances(input: {
  tripCurrency: string;
  rates: Rates;
  members: readonly string[];
  expenses: readonly Expense[];
  settlements: readonly Settlement[];
}): Balance[] {
  const rows = new Map<string, { paid: number; share: number; settled: number }>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      r = { paid: 0, share: 0, settled: 0 };
      rows.set(id, r);
    }
    return r;
  };
  for (const m of input.members) row(m);
  for (const e of input.expenses) {
    const total = convertMinor(e.amount, e.currency, input.tripCurrency, input.rates);
    if (total === null) continue;
    row(e.paidBy).paid += total;
    const parts = apportion(total, e.shares, e.currency);
    e.shares.forEach((s, i) => {
      row(s.userId).share += parts[i] ?? 0;
    });
  }
  for (const s of input.settlements) {
    const amount = convertMinor(s.amount, s.currency, input.tripCurrency, input.rates);
    if (amount === null) continue;
    row(s.fromUser).settled += amount;
    row(s.toUser).settled -= amount;
  }
  const c = input.tripCurrency;
  return [...rows.entries()].map(([userId, r]) => ({
    userId,
    paid: fromMinor(r.paid, c),
    share: fromMinor(r.share, c),
    net: fromMinor(r.paid - r.share + r.settled, c),
  }));
}

export interface Transfer {
  fromUser: string;
  toUser: string;
  amount: number;
}

// 誰付給誰：先配對金額相同的應付與應收，其餘每次由應付最多的人付給應收最多的人。
// 筆數不超過有餘額的人數減一
export function settleUp(balances: readonly Balance[], currency: string): Transfer[] {
  const creditors = balances.filter((b) => toMinor(b.net, currency) > 0).map((b) => ({ id: b.userId, left: toMinor(b.net, currency) }));
  const debtors = balances.filter((b) => toMinor(b.net, currency) < 0).map((b) => ({ id: b.userId, left: -toMinor(b.net, currency) }));
  const transfers: Transfer[] = [];
  const pay = (from: { id: string; left: number }, to: { id: string; left: number }, minor: number) => {
    transfers.push({ fromUser: from.id, toUser: to.id, amount: fromMinor(minor, currency) });
    from.left -= minor;
    to.left -= minor;
  };
  for (const cr of creditors) {
    const match = debtors.find((d) => d.left > 0 && d.left === cr.left);
    if (match) pay(match, cr, cr.left);
  }
  for (;;) {
    const cr = creditors.filter((x) => x.left > 0).sort((a, b) => b.left - a.left)[0];
    const de = debtors.filter((x) => x.left > 0).sort((a, b) => b.left - a.left)[0];
    if (!cr || !de) break;
    pay(de, cr, Math.min(cr.left, de.left));
  }
  return transfers;
}
