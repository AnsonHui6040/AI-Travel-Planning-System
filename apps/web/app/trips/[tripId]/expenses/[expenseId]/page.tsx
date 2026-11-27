import { convertAmount } from "@atps/core";
import type { Metadata } from "next";
import Link from "next/link";
import { CATEGORY_LABELS, expenseTitle, formatMoney, shortDate } from "../../../../../lib/expenses-format";
import { loadExpenses } from "../../../../../lib/server/expenses";
import { DeleteExpenseButton } from "../expense-forms";
import { BackLink, ExpenseRows, NotAvailable } from "../parts";
import "../expenses.css";

// 花費詳情：金額、換算、付款人、分攤；修改另開畫面，刪除先確認。1024px 以上左清單、右詳情

export const metadata: Metadata = { title: "花費詳情" };
export const dynamic = "force-dynamic";

export default async function ExpenseDetailPage({ params }: { params: Promise<{ tripId: string; expenseId: string }> }) {
  const { tripId, expenseId } = await params;
  const view = await loadExpenses(tripId);
  if (view.state !== "ok") return <NotAvailable title="花費詳情" state={view.state} />;
  const base = `/trips/${tripId}/expenses`;
  const e = view.expenses.find((x) => x.id === expenseId);
  const nameOf = (id: string) => view.members.find((m) => m.userId === id)?.name ?? "已離開的成員";
  const converted = e && e.currency !== view.currency ? convertAmount(e.amount, e.currency, view.currency, view.rates) : null;
  return (
    <main className="screen wide expenses">
      <header className="screen-head">
        <BackLink href={`${base}/list`} label="花費清單" />
        <h1>{e ? expenseTitle(e) : "花費詳情"}</h1>
      </header>
      <div className="split" data-detail="open">
        <section aria-label="花費" className="split-list">
          <ExpenseRows view={view} currentId={expenseId} />
        </section>
        <div className="split-detail">
          {e ? (
            <>
              <section aria-label="花費詳情" className="screen-body">
                <p className="figure">{formatMoney(e.amount, e.currency)}</p>
                {e.currency !== view.currency ? (
                  <p className={converted === null ? "figure-note risk" : "figure-note"}>
                    {converted === null ? `沒有 ${e.currency} 的匯率，未計入總額` : `約 ${formatMoney(converted, view.currency)}`}
                  </p>
                ) : null}
                <dl className="detail-facts">
                  <dt>付款</dt>
                  <dd>{nameOf(e.paidBy)}付款</dd>
                  <dt>日期</dt>
                  <dd>{shortDate(e.spentOn)}</dd>
                  <dt>類別</dt>
                  <dd>{CATEGORY_LABELS[e.category]}</dd>
                  {e.itemName ? (
                    <>
                      <dt>項目</dt>
                      <dd>{e.itemName}</dd>
                    </>
                  ) : null}
                </dl>
                <h2>分攤</h2>
                <ul aria-label="分攤" className="rows compact-rows">
                  {e.shares.map((s) => (
                    <li key={s.userId}>
                      <span>{nameOf(s.userId)}</span>
                      <span>{formatMoney(s.amount, e.currency)}</span>
                    </li>
                  ))}
                </ul>
              </section>
              {view.canEdit ? (
                <div className="screen-actions">
                  <Link className="secondary" href={`${base}/${e.id}/edit`}>
                    修改
                  </Link>
                  <DeleteExpenseButton tripId={tripId} expenseId={e.id} />
                </div>
              ) : null}
            </>
          ) : (
            <p>找不到這筆花費。</p>
          )}
        </div>
      </div>
    </main>
  );
}
