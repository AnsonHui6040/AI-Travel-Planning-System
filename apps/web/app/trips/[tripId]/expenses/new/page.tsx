import type { Metadata } from "next";
import { loadExpenses } from "../../../../../lib/server/expenses";
import { ExpenseFormScreen } from "../form-page";
import { NotAvailable } from "../parts";
import "../expenses.css";

export const metadata: Metadata = { title: "新增花費" };
export const dynamic = "force-dynamic";

export default async function NewExpensePage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const view = await loadExpenses(tripId);
  if (view.state !== "ok") return <NotAvailable title="新增花費" state={view.state} />;
  return <ExpenseFormScreen view={view} expenseId={null} />;
}
