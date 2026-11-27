import { budgetStatus, expenseBalances, expenseTotals, settleUp } from "@atps/core";
import Link from "next/link";
import { ScrollKeeper } from "../../../../components/scroll-keeper";
import { expenseTitle, formatMoney, shortDate } from "../../../../lib/expenses-format";
import type { ExpensesView } from "../../../../lib/server/expenses";

// 決策 0010 X：記帳畫面共用的部分（伺服器元件）

export type OkView = Extract<ExpensesView, { state: "ok" }>;

const UNAVAILABLE = { signed_out: "請先登入。", not_found: "找不到這個行程，或你不是成員。", disabled: "記帳功能尚未開啟。" } as const;

export function NotAvailable({ title, state }: { title: string; state: keyof typeof UNAVAILABLE }) {
  return (
    <main className="screen expenses">
      <h1>{title}</h1>
      <p>{UNAVAILABLE[state]}</p>
    </main>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link className="back-link" href={href}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M15 5l-7 7 7 7" />
      </svg>
      {label}
    </Link>
  );
}

export const READ_ONLY = "只有 Owner 與 Companion 可以記帳；你可以檢視。";

// 總覽、結算共用的計算（主幣別）
export function computeExpenses(view: OkView) {
  const totals = expenseTotals({ tripCurrency: view.currency, rates: view.rates, expenses: view.expenses });
  const budget = budgetStatus({ total: totals.total, tripCurrency: view.currency, budget: view.budget, rates: view.rates });
  const balances = expenseBalances({
    tripCurrency: view.currency,
    rates: view.rates,
    members: view.members.filter((m) => m.current).map((m) => m.userId),
    expenses: view.expenses,
    settlements: view.settlements,
  });
  const transfers = settleUp(balances, view.currency);
  const nameOf = (id: string) => view.members.find((m) => m.userId === id)?.name ?? "已離開的成員";
  return { totals, budget, balances, transfers, nameOf };
}

export function missingRateText(view: OkView, totals: ReturnType<typeof expenseTotals>): string | null {
  if (totals.excludedCount === 0) return null;
  return `${totals.excludedCount} 筆 ${totals.missingRates.join("、")} 花費沒有匯率，未計入`;
}

export function ExpenseRows({ view, currentId }: { view: OkView; currentId: string | null }) {
  const nameOf = (id: string) => view.members.find((m) => m.userId === id)?.name ?? "已離開的成員";
  return (
    <ScrollKeeper scrollKey={`expenses:${view.tripId}`}>
      {view.expenses.length === 0 ? <p className="muted">還沒有花費。</p> : null}
      <ul aria-label="花費清單" className="rows expense-rows">
        {view.expenses.map((e) => (
          <li key={e.id}>
            <Link href={`/trips/${view.tripId}/expenses/${e.id}`} aria-current={e.id === currentId ? "page" : undefined}>
              <span className="row-time">{shortDate(e.spentOn)}</span>
              <span className="expense-row-text">
                <span className="row-name">{expenseTitle(e)}</span>
                <span className="row-meta">{nameOf(e.paidBy)}付款</span>
              </span>
              <span className="expense-amount">{formatMoney(e.amount, e.currency)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </ScrollKeeper>
  );
}
