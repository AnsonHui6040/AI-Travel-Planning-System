import type { Metadata } from "next";
import { loadExpenses } from "../../../../../../lib/server/expenses";
import { ExpenseFormScreen } from "../../form-page";
import { NotAvailable } from "../../parts";
import "../../expenses.css";

export const metadata: Metadata = { title: "修改花費" };
export const dynamic = "force-dynamic";

export default async function EditExpensePage({ params }: { params: Promise<{ tripId: string; expenseId: string }> }) {
  const { tripId, expenseId } = await params;
  const view = await loadExpenses(tripId);
  if (view.state !== "ok") return <NotAvailable title="修改花費" state={view.state} />;
  return <ExpenseFormScreen view={view} expenseId={expenseId} />;
}
