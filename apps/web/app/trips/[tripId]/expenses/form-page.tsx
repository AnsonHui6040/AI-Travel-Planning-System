import type { ExpenseCategory } from "@atps/core";
import { currencyOptions } from "../../../../lib/expenses-format";
import { ExpenseForm, type ExpenseFormInitial } from "./expense-forms";
import { BackLink, READ_ONLY, type OkView } from "./parts";

// 新增與修改花費共用的畫面（一個畫面一件事：表單與儲存，不用捲動）

export function ExpenseFormScreen({ view, expenseId }: { view: OkView; expenseId: string | null }) {
  const base = `/trips/${view.tripId}/expenses`;
  const existing = expenseId ? view.expenses.find((e) => e.id === expenseId) : undefined;
  const title = expenseId ? "修改花費" : "新增花費";
  const back = existing ? `${base}/${existing.id}` : base;
  if (expenseId && !existing) {
    return (
      <main className="screen expenses">
        <BackLink href={`${base}/list`} label="花費清單" />
        <h1>{title}</h1>
        <p>找不到這筆花費。</p>
      </main>
    );
  }
  const current = view.members.filter((m) => m.current);
  const me = current.find((m) => m.isMe)?.userId ?? current[0]?.userId ?? "";
  const initial: ExpenseFormInitial = existing
    ? {
        amount: String(existing.amount),
        currency: existing.currency,
        paidBy: existing.paidBy,
        spentOn: existing.spentOn,
        category: existing.category,
        itemId: existing.itemId ?? "",
        note: existing.note ?? "",
        split: "custom",
        members: existing.shares.map((s) => s.userId),
        custom: Object.fromEntries(existing.shares.map((s) => [s.userId, String(s.amount)])),
      }
    : {
        amount: "",
        currency: view.currency,
        paidBy: me,
        spentOn: view.today,
        category: "food" as ExpenseCategory,
        itemId: "",
        note: "",
        split: "equal",
        members: current.map((m) => m.userId),
        custom: {},
      };
  // 修改舊花費時，已離開的成員仍列在分攤中
  const formMembers = existing
    ? view.members.filter((m) => m.current || existing.shares.some((s) => s.userId === m.userId) || m.userId === existing.paidBy)
    : current;
  return (
    <main className="screen expenses">
      <header className="screen-head">
        <BackLink href={back} label={existing ? "花費詳情" : "記帳"} />
        <h1>{title}</h1>
      </header>
      {view.canEdit ? (
        <ExpenseForm
          tripId={view.tripId}
          expenseId={existing?.id ?? null}
          initial={initial}
          members={formMembers.map((m) => ({ userId: m.userId, name: m.name }))}
          items={view.items}
          currencies={currencyOptions(view.currency, Object.keys(view.rates), existing ? [existing.currency] : [])}
          cancelHref={back}
        />
      ) : (
        <p>{READ_ONLY}</p>
      )}
    </main>
  );
}
