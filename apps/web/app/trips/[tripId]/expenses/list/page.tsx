import type { Metadata } from "next";
import { loadExpenses } from "../../../../../lib/server/expenses";
import { BackLink, ExpenseRows, NotAvailable } from "../parts";
import "../expenses.css";

// 花費清單：每項一行（日期、名稱、付款人、金額）；1024px 以上左清單、右詳情

export const metadata: Metadata = { title: "花費清單" };
export const dynamic = "force-dynamic";

export default async function ExpenseListPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const view = await loadExpenses(tripId);
  if (view.state !== "ok") return <NotAvailable title="花費清單" state={view.state} />;
  return (
    <main className="screen wide expenses">
      <header className="screen-head">
        <BackLink href={`/trips/${tripId}/expenses`} label="記帳" />
        <h1>花費清單</h1>
        <p>{view.expenses.length} 筆</p>
      </header>
      <div className="split" data-detail="none">
        <section aria-label="花費" className="split-list">
          <ExpenseRows view={view} currentId={null} />
        </section>
        <div className="split-detail">
          <p className="empty-detail">選擇一筆花費查看分攤。</p>
        </div>
      </div>
    </main>
  );
}
