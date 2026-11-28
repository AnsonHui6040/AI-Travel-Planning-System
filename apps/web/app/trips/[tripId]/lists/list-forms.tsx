"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { LIST_KIND_LABELS } from "../../../../lib/booking-format";
import type { BookingActionResult } from "../../../../lib/server/bookings-core";
import { addListItem, createList, deleteList, deleteListItem, setListItemAssignee, setListItemChecked } from "./actions";

// 決策 0010 B：清單的表單。受控欄位與核取方塊不放在以 action 送出的 <form> 內（React 19 會在 Server Action 後重設表單），
// 改由 onSubmit／onChange 呼叫 Server Action；權限由資料庫再檢查

export interface ListMember {
  userId: string;
  name: string;
}

function Status({ result }: { result: BookingActionResult | null }) {
  return result && !result.ok ? (
    <p role="status" className="error">
      {result.message}
    </p>
  ) : null;
}

export function CreateListForm({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [kind, setKind] = useState<"packing" | "todo">("packing");
  const [title, setTitle] = useState("");
  const [result, setResult] = useState<BookingActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      aria-label="新增清單"
      className="list-add-form"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const r = await createList({ tripId, kind, title });
          setResult(r);
          if (r.ok && r.id) router.push(`/trips/${tripId}/lists/${r.id}`);
        });
      }}
    >
      <label>
        類型
        <select value={kind} onChange={(e) => setKind(e.target.value as "packing" | "todo")}>
          <option value="packing">{LIST_KIND_LABELS.packing}</option>
          <option value="todo">{LIST_KIND_LABELS.todo}</option>
        </select>
      </label>
      <label>
        名稱
        <input maxLength={40} autoComplete="off" placeholder={LIST_KIND_LABELS[kind]} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <button className="primary" type="submit" disabled={pending}>
        新增清單
      </button>
      <Status result={result} />
    </form>
  );
}

function AssigneeSelect({ id, label, value, members, onChange, disabled }: { id?: string; label: string; value: string; members: ListMember[]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <select id={id} aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">不指定</option>
      {members.map((m) => (
        <option key={m.userId} value={m.userId}>
          {m.name}
        </option>
      ))}
    </select>
  );
}

export function AddItemForm({ tripId, listId, members }: { tripId: string; listId: string; members: ListMember[] }) {
  const [text, setText] = useState("");
  const [assignee, setAssignee] = useState("");
  const [result, setResult] = useState<BookingActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      aria-label="新增項目"
      className="list-add-form"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const r = await addListItem({ tripId, listId, text, assignee });
          setResult(r);
          if (r.ok) setText("");
        });
      }}
    >
      <label>
        項目
        <input required maxLength={120} autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <label>
        負責
        <AssigneeSelect label="負責成員" value={assignee} members={members} onChange={setAssignee} />
      </label>
      <button className="primary" type="submit" disabled={pending}>
        新增
      </button>
      <Status result={result} />
    </form>
  );
}

export function ChecklistItemRow({
  tripId,
  item,
  members,
  canEdit,
}: {
  tripId: string;
  item: { id: string; text: string; assignee: string | null; checked: boolean };
  members: ListMember[];
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<BookingActionResult | null>(null);
  // 勾選立即反映；伺服器更新後以資料庫的值為準，失敗時還原
  const [checked, setChecked] = useState(item.checked);
  useEffect(() => setChecked(item.checked), [item.checked]);
  const name = item.assignee ? (members.find((m) => m.userId === item.assignee)?.name ?? "已離開的成員") : null;
  const run = (action: () => Promise<BookingActionResult>) =>
    startTransition(async () => {
      setResult(await action());
    });
  return (
    <li className={checked ? "checklist-item done" : "checklist-item"}>
      <label className="checklist-check">
        <input
          type="checkbox"
          checked={checked}
          disabled={!canEdit || pending}
          onChange={(e) => {
            const next = e.target.checked;
            setChecked(next);
            startTransition(async () => {
              const r = await setListItemChecked(tripId, item.id, next);
              setResult(r);
              if (!r.ok) setChecked(!next);
            });
          }}
        />
        <span className="checklist-text">{item.text}</span>
      </label>
      {canEdit ? (
        <AssigneeSelect label={`${item.text} 的負責成員`} value={item.assignee ?? ""} members={members} disabled={pending} onChange={(v) => run(() => setListItemAssignee(tripId, item.id, v))} />
      ) : (
        <span className="row-meta">{name ?? ""}</span>
      )}
      {canEdit ? (
        <button
          className="danger"
          type="button"
          aria-label={`刪除 ${item.text}`}
          disabled={pending}
          onClick={() => {
            if (!window.confirm(`刪除「${item.text}」？`)) return;
            run(() => deleteListItem(tripId, item.id));
          }}
        >
          刪除
        </button>
      ) : null}
      <Status result={result} />
    </li>
  );
}

export function DeleteListButton({ tripId, listId, title }: { tripId: string; listId: string; title: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="danger"
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`刪除清單「${title}」與其中所有項目？刪除後無法復原。`)) return;
        startTransition(async () => {
          const r = await deleteList(tripId, listId);
          if (r.ok) router.push(`/trips/${tripId}/lists`);
        });
      }}
    >
      刪除清單
    </button>
  );
}
