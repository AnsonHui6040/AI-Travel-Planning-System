import type { Metadata } from "next";
import Link from "next/link";
import { CATEGORY_LABELS, balanceText, formatMoney } from "../../../../lib/expenses-format";
import { loadExpenses } from "../../../../lib/server/expenses";
import { NotAvailable, READ_ONLY, computeExpenses, missingRateText } from "./parts";
import "./expenses.css";

// 決策 0010 X：記帳總覽。總花費、與基線預算比較、各類別、每人餘額；新增、清單、結算、幣別與匯率另開畫面

export const metadata: Metadata = { title: "記帳" };
export const dynamic = "force-dynamic";

export default async function ExpensesPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const view = await loadExpenses(tripId);
  if (view.state !== "ok") return <NotAvailable title="記帳" state={view.state} />;
  const { totals, budget, balances, nameOf } = computeExpenses(view);
  const c = view.currency;
  const missing = missingRateText(view, totals);
  const categories = totals.byCategory.filter((x) => x.amount !== 0);
  const base = `/trips/${tripId}/expenses`;
  return (
    <main className="screen wide expenses">
      <header className="screen-head">
        <h1>記帳</h1>
        <p>{view.tripName}</p>
      </header>
      <div className="expense-summary">
        <section aria-label="總花費">
          <h2>總花費</h2>
          <p className="figure">{formatMoney(totals.total, c)}</p>
          <p className={missing ? "figure-note risk" : "figure-note"}>{missing ?? `${view.expenses.length} 筆，主幣別 ${c}`}</p>
        </section>
        <section aria-label="預算">
          <h2>預算</h2>
          {budget.state === "none" ? <p className="figure-note">基線沒有設定預算</p> : null}
          {budget.state === "no_rate" ? <p className="figure-note risk">預算為 {budget.currency}，請輸入 {budget.currency} 的匯率</p> : null}
          {budget.state === "within" || budget.state === "over" ? (
            <>
              <p className={budget.state === "over" ? "figure secondary-figure risk" : "figure secondary-figure"}>
                {budget.state === "over" ? `超出 ${formatMoney(-budget.remaining, c)}` : `剩餘 ${formatMoney(budget.remaining, c)}`}
              </p>
              <p className="figure-note">
                預算 {formatMoney(budget.budget, c)}，已用 {budget.usedPercent}%
              </p>
            </>
          ) : null}
        </section>
      </div>
      <div className="screen-body expense-columns">
        <section aria-labelledby="by-category">
          <h2 id="by-category">各類別</h2>
          {categories.length === 0 ? <p className="muted">還沒有花費。</p> : null}
          <ul aria-label="各類別" className="rows compact-rows">
            {categories.map((x) => (
              <li key={x.category}>
                <span>{CATEGORY_LABELS[x.category]}</span>
                <span>{formatMoney(x.amount, c)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="by-member">
          <h2 id="by-member">每人餘額</h2>
          <ul aria-label="每人餘額" className="rows compact-rows">
            {balances.map((b) => (
              <li key={b.userId}>
                <span>{nameOf(b.userId)}</span>
                <span className={b.net < 0 ? "risk" : undefined}>{balanceText(b.net, c)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <nav aria-label="記帳" className="expense-links">
        <Link className="secondary" href={`${base}/list`}>
          花費清單 {view.expenses.length}
        </Link>
        <Link className="secondary" href={`${base}/settle`}>
          結算
        </Link>
        <Link className="secondary" href={`${base}/rates`}>
          幣別與匯率
        </Link>
      </nav>
      <div className="screen-actions">
        {view.canEdit ? (
          <Link className="primary" href={`${base}/new`}>
            新增花費
          </Link>
        ) : (
          <p className="muted">{READ_ONLY}</p>
        )}
      </div>
    </main>
  );
}
