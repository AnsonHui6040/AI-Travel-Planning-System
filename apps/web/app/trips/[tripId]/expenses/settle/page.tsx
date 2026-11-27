import type { Metadata } from "next";
import { formatMoney, shortDate } from "../../../../../lib/expenses-format";
import { loadExpenses } from "../../../../../lib/server/expenses";
import { MarkPaidButton, UndoSettlementButton } from "../expense-forms";
import { BackLink, NotAvailable, READ_ONLY, computeExpenses, missingRateText } from "../parts";
import "../expenses.css";

// 結算：誰付給誰（最少筆數），標記已付款與日期；已付款的紀錄可刪除

export const metadata: Metadata = { title: "結算" };
export const dynamic = "force-dynamic";

export default async function SettlePage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const view = await loadExpenses(tripId);
  if (view.state !== "ok") return <NotAvailable title="結算" state={view.state} />;
  const { totals, transfers, nameOf } = computeExpenses(view);
  const c = view.currency;
  const missing = missingRateText(view, totals);
  return (
    <main className="screen wide expenses">
      <header className="screen-head">
        <BackLink href={`/trips/${tripId}/expenses`} label="記帳" />
        <h1>結算</h1>
        <p>以主幣別 {c} 計算，付款日期為今天（{shortDate(view.today)}）</p>
      </header>
      <div className="screen-body expense-columns">
        <section aria-labelledby="transfers">
          <h2 id="transfers">建議轉帳</h2>
          {missing ? <p className="figure-note risk">{missing}</p> : null}
          {transfers.length === 0 ? <p className="muted">所有人都已結清。</p> : null}
          <ul aria-label="建議轉帳" className="rows">
            {transfers.map((t) => (
              <li key={`${t.fromUser}-${t.toUser}`} className="transfer-row">
                <span>
                  <span className="row-name">
                    {nameOf(t.fromUser)}付給{nameOf(t.toUser)}
                  </span>
                  <span className="expense-amount">{formatMoney(t.amount, c)}</span>
                </span>
                {view.canEdit ? <MarkPaidButton tripId={tripId} transfer={t} currency={c} paidOn={view.today} /> : null}
              </li>
            ))}
          </ul>
          {!view.canEdit ? <p className="muted">{READ_ONLY}</p> : null}
        </section>
        <section aria-labelledby="paid">
          <h2 id="paid">已付款</h2>
          {view.settlements.length === 0 ? <p className="muted">還沒有付款紀錄。</p> : null}
          <ul aria-label="已付款" className="rows">
            {view.settlements.map((s) => (
              <li key={s.id} className="transfer-row">
                <span>
                  <span className="row-name">
                    {nameOf(s.fromUser)}付給{nameOf(s.toUser)}
                  </span>
                  <span className="expense-amount">{formatMoney(s.amount, s.currency)}</span>
                  <span className="row-meta">，{shortDate(s.paidOn)}</span>
                </span>
                {view.canEdit ? <UndoSettlementButton tripId={tripId} settlementId={s.id} /> : null}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
