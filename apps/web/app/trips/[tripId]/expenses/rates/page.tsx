import type { Metadata } from "next";
import { currencyOptions } from "../../../../../lib/expenses-format";
import { loadExpenses } from "../../../../../lib/server/expenses";
import { CurrencyForm, DeleteRateButton, RateForm } from "../expense-forms";
import { BackLink, NotAvailable, READ_ONLY } from "../parts";
import "../expenses.css";

// 幣別與匯率：主幣別（未設定時沿用基線預算的幣別，再沒有則為 TWD）；外幣匯率由使用者輸入，不呼叫外部匯率服務

export const metadata: Metadata = { title: "幣別與匯率" };
export const dynamic = "force-dynamic";

export default async function RatesPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const view = await loadExpenses(tripId);
  if (view.state !== "ok") return <NotAvailable title="幣別與匯率" state={view.state} />;
  const c = view.currency;
  const used = [...new Set(view.expenses.map((e) => e.currency))];
  const foreign = currencyOptions(used, view.budget ? [view.budget.currency] : []).filter((x) => x !== c);
  const rates = Object.entries(view.rates).filter(([cur]) => cur !== c);
  return (
    <main className="screen expenses">
      <header className="screen-head">
        <BackLink href={`/trips/${tripId}/expenses`} label="記帳" />
        <h1>幣別與匯率</h1>
        <p>匯率由你輸入：1 單位外幣等於多少 {c}。變更主幣別後，請重新確認匯率。</p>
      </header>
      <div className="screen-body">
        {view.canEdit ? <CurrencyForm tripId={tripId} currency={c} currencies={currencyOptions(c)} /> : <p>主幣別：{c}</p>}
        <h2>匯率</h2>
        {rates.length === 0 ? <p className="muted">還沒有匯率。</p> : null}
        <ul aria-label="已輸入的匯率" className="rows compact-rows">
          {rates.map(([cur, rate]) => (
            <li key={cur}>
              <span>
                1 {cur} = {rate} {c}
              </span>
              {view.canEdit ? <DeleteRateButton tripId={tripId} currency={cur} /> : null}
            </li>
          ))}
        </ul>
      </div>
      <div className="screen-actions">{view.canEdit ? <RateForm tripId={tripId} currencies={foreign} /> : <p className="muted">{READ_ONLY}</p>}</div>
    </main>
  );
}
