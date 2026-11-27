"use client";

import { EXPENSE_CATEGORIES, splitEqually, type ExpenseCategory } from "@atps/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { CATEGORY_LABELS, formatMoney } from "../../../../lib/expenses-format";
import type { ExpenseActionResult } from "../../../../lib/server/expenses-core";
import { deleteExpense, deleteRate, deleteSettlement, recordSettlement, saveExpense, saveRate, setCurrency } from "./actions";

// 決策 0010 X：記帳的表單。受控欄位不放在以 action 送出的 <form> 內（React 19 會在 Server Action 後重設表單），
// 改由 onSubmit 呼叫 Server Action。分攤預覽以 core 計算；伺服器與資料庫再檢查一次

export interface FormMember {
  userId: string;
  name: string;
}

export interface ExpenseFormInitial {
  amount: string;
  currency: string;
  paidBy: string;
  spentOn: string;
  category: ExpenseCategory;
  itemId: string;
  note: string;
  split: "equal" | "custom";
  members: string[];
  custom: Record<string, string>;
}

function Status({ result }: { result: ExpenseActionResult | null }) {
  return result ? (
    <p role="status" className={result.ok ? "ok" : "error"}>
      {result.message}
    </p>
  ) : null;
}

export function ExpenseForm({
  tripId,
  expenseId,
  initial,
  members,
  items,
  currencies,
  cancelHref,
}: {
  tripId: string;
  expenseId: string | null;
  initial: ExpenseFormInitial;
  members: FormMember[];
  items: Array<{ id: string; name: string }>;
  currencies: string[];
  cancelHref: string;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [result, setResult] = useState<ExpenseActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof ExpenseFormInitial>(key: K, value: ExpenseFormInitial[K]) => setV((prev) => ({ ...prev, [key]: value }));
  const amount = /^\d+(\.\d+)?$/.test(v.amount.trim()) ? Number(v.amount.trim()) : 0;
  const preview = new Map(splitEqually(amount, v.currency, v.members).map((s) => [s.userId, s.amount]));
  const toggle = (userId: string, on: boolean) =>
    set(
      "members",
      members.map((m) => m.userId).filter((id) => (id === userId ? on : v.members.includes(id))),
    );

  return (
    <form
      aria-label={expenseId ? "修改花費" : "新增花費"}
      className="screen-form expense-form"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const r = await saveExpense({ tripId, expenseId, ...v });
          setResult(r);
          if (r.ok && r.id) router.push(`/trips/${tripId}/expenses/${r.id}`);
        });
      }}
    >
      <div className="screen-body">
        <div className="fields">
          <label className="field">
            金額
            <input inputMode="decimal" autoComplete="off" required value={v.amount} onChange={(e) => set("amount", e.target.value)} />
          </label>
          <label className="field">
            幣別
            <select value={v.currency} onChange={(e) => set("currency", e.target.value)}>
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            日期
            <input type="date" required value={v.spentOn} onChange={(e) => set("spentOn", e.target.value)} />
          </label>
          <label className="field">
            類別
            <select value={v.category} onChange={(e) => set("category", e.target.value as ExpenseCategory)}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            付款人
            <select value={v.paidBy} onChange={(e) => set("paidBy", e.target.value)}>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            關聯項目
            <select value={v.itemId} onChange={(e) => set("itemId", e.target.value)}>
              <option value="">無</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field wide">
            備註
            <input maxLength={200} value={v.note} onChange={(e) => set("note", e.target.value)} />
          </label>
        </div>
        <fieldset aria-label="分攤">
          <div className="split-mode">
            <span className="split-label">分攤</span>
            <label>
              <input type="radio" name="split" checked={v.split === "equal"} onChange={() => set("split", "equal")} />
              平均
            </label>
            <label>
              <input type="radio" name="split" checked={v.split === "custom"} onChange={() => set("split", "custom")} />
              自訂金額
            </label>
          </div>
          <ul className="share-rows">
            {members.map((m) => {
              const on = v.members.includes(m.userId);
              return (
                <li key={m.userId} className="share-row">
                  <label>
                    <input type="checkbox" checked={on} onChange={(e) => toggle(m.userId, e.target.checked)} />
                    {m.name}
                  </label>
                  {v.split === "custom" ? (
                    <input
                      aria-label={`${m.name} 的分攤`}
                      inputMode="decimal"
                      autoComplete="off"
                      disabled={!on}
                      value={v.custom[m.userId] ?? ""}
                      onChange={(e) => set("custom", { ...v.custom, [m.userId]: e.target.value })}
                    />
                  ) : (
                    <span className="share-value">{on ? formatMoney(preview.get(m.userId) ?? 0, v.currency) : "不分攤"}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </fieldset>
        <Status result={result} />
      </div>
      <div className="screen-actions">
        <Link className="ghost" href={cancelHref}>
          取消
        </Link>
        <button className="primary" type="submit" disabled={pending}>
          儲存
        </button>
      </div>
    </form>
  );
}

export function DeleteExpenseButton({ tripId, expenseId }: { tripId: string; expenseId: string }) {
  const router = useRouter();
  const [result, setResult] = useState<ExpenseActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <button
        className="danger"
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("刪除這筆花費？刪除後無法復原。")) return;
          startTransition(async () => {
            const r = await deleteExpense(tripId, expenseId);
            setResult(r);
            if (r.ok) router.push(`/trips/${tripId}/expenses/list`);
          });
        }}
      >
        刪除
      </button>
      {result && !result.ok ? <Status result={result} /> : null}
    </>
  );
}

export function MarkPaidButton({
  tripId,
  transfer,
  currency,
  paidOn,
}: {
  tripId: string;
  transfer: { fromUser: string; toUser: string; amount: number };
  currency: string;
  paidOn: string;
}) {
  const [result, setResult] = useState<ExpenseActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <button
        className="secondary"
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setResult(await recordSettlement({ tripId, ...transfer, amount: String(transfer.amount), currency, paidOn }));
          })
        }
      >
        標記已付款
      </button>
      {result && !result.ok ? <Status result={result} /> : null}
    </>
  );
}

export function UndoSettlementButton({ tripId, settlementId }: { tripId: string; settlementId: string }) {
  const [result, setResult] = useState<ExpenseActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <button
        className="danger"
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("刪除這筆付款紀錄？")) return;
          startTransition(async () => setResult(await deleteSettlement(tripId, settlementId)));
        }}
      >
        刪除
      </button>
      {result && !result.ok ? <Status result={result} /> : null}
    </>
  );
}

export function CurrencyForm({ tripId, currency, currencies }: { tripId: string; currency: string; currencies: string[] }) {
  const [state, action, pending] = useActionState(setCurrency, null);
  return (
    <form action={action} className="inline-form" aria-label="主幣別">
      <input type="hidden" name="tripId" value={tripId} />
      <label>
        主幣別
        <select name="currency" defaultValue={currency}>
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <span />
      <button className="secondary" type="submit" disabled={pending}>
        儲存主幣別
      </button>
      {state ? <Status result={state} /> : null}
    </form>
  );
}

export function RateForm({ tripId, currencies }: { tripId: string; currencies: string[] }) {
  const [state, action, pending] = useActionState(saveRate, null);
  return (
    <form action={action} className="inline-form" aria-label="新增匯率">
      <input type="hidden" name="tripId" value={tripId} />
      <label>
        外幣
        <select name="currency">
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label>
        匯率
        <input name="rate" inputMode="decimal" autoComplete="off" required />
      </label>
      <button className="primary" type="submit" disabled={pending}>
        儲存匯率
      </button>
      {state ? <Status result={state} /> : null}
    </form>
  );
}

export function DeleteRateButton({ tripId, currency }: { tripId: string; currency: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="danger"
      type="button"
      disabled={pending}
      aria-label={`刪除 ${currency} 的匯率`}
      onClick={() => {
        if (!window.confirm(`刪除 ${currency} 的匯率？這個幣別的花費將不計入總額。`)) return;
        startTransition(async () => {
          await deleteRate(tripId, currency);
        });
      }}
    >
      刪除
    </button>
  );
}
