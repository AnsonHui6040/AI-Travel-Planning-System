import { currencyDecimals, type ExpenseCategory } from "@atps/core";

// 決策 0010 X：記帳畫面的文字（伺服器與瀏覽器端共用）

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  food: "餐飲",
  transport: "交通",
  lodging: "住宿",
  tickets: "門票",
  shopping: "購物",
  other: "其他",
};

// 常用幣別；行程的主幣別與已輸入匯率的幣別另外加入
export const COMMON_CURRENCIES = ["TWD", "JPY", "KRW", "USD", "EUR", "HKD", "CNY", "THB", "SGD", "GBP", "AUD", "VND"] as const;

export function currencyOptions(...extra: Array<string | readonly string[]>): string[] {
  return [...new Set([...extra.flat(), ...COMMON_CURRENCIES])];
}

export function formatMoney(amount: number, currency: string): string {
  const d = currencyDecimals(currency);
  return `${new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(amount)} ${currency}`;
}

export function balanceText(net: number, currency: string): string {
  if (net > 0) return `應收 ${formatMoney(net, currency)}`;
  if (net < 0) return `應付 ${formatMoney(-net, currency)}`;
  return "已結清";
}

// 2026-12-01 → 12/1
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export function expenseTitle(e: { note: string | null; itemName: string | null; category: ExpenseCategory }): string {
  return e.note ?? e.itemName ?? CATEGORY_LABELS[e.category];
}
