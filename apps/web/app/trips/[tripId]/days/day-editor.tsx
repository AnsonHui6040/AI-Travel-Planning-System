"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { legGapMinutes, shiftDay, reorderDesired, type EditMode, type Leg } from "@atps/core";
import { ScrollKeeper } from "../../../../components/scroll-keeper";
import { EDIT_HINTS } from "../../../../lib/edit-mode";
import { ITEM_TYPE_LABELS, TRAVEL_MODE_LABELS, USER_TRAVEL_MODES } from "../../../../lib/item-labels";
import type { EditResult } from "../../../../lib/server/item-edit-core";
import type { TripEditResult } from "../../../../lib/server/trip-edit-core";
import { editItem, saveDayBatch } from "../items/actions";
import { saveTravelLeg } from "./actions";

// 決策 0011：行程分頁的當日清單與清單內編輯模式（類似 iOS 提醒事項）。
// 一般模式：每項一行，點進去看詳情；相鄰兩項之間顯示交通（成員輸入、T28 估算或未設定）。
// 編輯模式：拖曳把手（滑鼠、觸控；鍵盤上下鍵）、44px 上移與下移、刪除（window.confirm）、開始與結束時間、在後面插入。
// 時間、停留或順序改變時，後面的項目依停留加交通（withBuffer 規則）自動順延並先預覽，可選「不要順延」；
// 固定活動與預訂不移動。「完成」一次送出：鎖定前一個交易、Owner 一筆 Change Log、Companion 一個提案。

export interface EditorRow {
  itemId: string;
  name: string;
  start: string;
  end: string;
  meta: string;
  risk: boolean;
}

export interface EditorLeg {
  minutes: number;
  mode: string | null;
  source: "user" | "estimate" | "none";
}

interface Desired {
  itemId: string;
  name: string;
  start: string;
  stay: number;
  added?: { type: keyof typeof ITEM_TYPE_LABELS };
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toHhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const toLeg = (leg: EditorLeg | undefined): Leg =>
  !leg || leg.source === "none" ? null : leg.source === "user" ? { source: "user", minutes: leg.minutes } : { source: "estimate", minutes: leg.minutes };

function legText(leg: EditorLeg | undefined): string {
  if (!leg || leg.source === "none") return "交通未設定";
  const mode = TRAVEL_MODE_LABELS[leg.mode ?? ""] ?? "交通";
  return leg.source === "user" ? `${mode} ${leg.minutes} 分鐘` : `${mode}約 ${leg.minutes} 分鐘（估算）`;
}

const fromRows = (rows: readonly EditorRow[]): Desired[] => rows.map((r) => ({ itemId: r.itemId, name: r.name, start: r.start, stay: toMin(r.end) - toMin(r.start) }));

function TravelLeg({ tripId, from, to, leg, canEdit }: { tripId: string; from: string; to: string; leg: EditorLeg | undefined; canEdit: boolean }) {
  const [state, action, pending] = useActionState<TripEditResult | null, FormData>(saveTravelLeg, null);
  const label = legText(leg);
  if (!canEdit) {
    return (
      <li className="travel-row">
        <span className="travel-text">{label}</span>
      </li>
    );
  }
  return (
    <li className="travel-row">
      <details className="travel-details">
        <summary>
          <span className="travel-text">{label}</span>
          <span className="travel-set">{leg?.source === "user" ? "修改" : "設定"}</span>
        </summary>
        <form action={action} className="travel-form">
          <input type="hidden" name="tripId" value={tripId} />
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="to" value={to} />
          <label>
            <span className="sr-only">交通方式</span>
            <select name="mode" defaultValue={leg?.source === "user" ? (leg.mode ?? "walk") : "train"}>
              {USER_TRAVEL_MODES.map((m) => (
                <option key={m} value={m}>
                  {TRAVEL_MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">分鐘</span>
            <input name="minutes" type="number" inputMode="numeric" min={0} max={600} step={1} defaultValue={leg?.source === "user" ? leg.minutes : 15} />
          </label>
          <button className="secondary" type="submit" disabled={pending}>
            儲存
          </button>
          {state ? (
            <p role="status" className={state.ok ? "travel-status" : "travel-status error"}>
              {state.message}
            </p>
          ) : null}
        </form>
      </details>
    </li>
  );
}

function InsertForm({ onAdd, onCancel }: { onAdd: (name: string, type: keyof typeof ITEM_TYPE_LABELS, stay: number) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<keyof typeof ITEM_TYPE_LABELS>("attraction");
  const [stay, setStay] = useState("60");
  const stayMinutes = Number(stay);
  const valid = name.trim().length > 0 && name.trim().length <= 80 && Number.isInteger(stayMinutes) && stayMinutes >= 5 && stayMinutes <= 600;
  return (
    <li className="insert-panel" aria-label="插入地點">
      <label className="insert-name">
        名稱
        <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus />
      </label>
      <div className="form-grid insert-fields">
        <label>
          類型
          <select value={type} onChange={(e) => setType(e.target.value as keyof typeof ITEM_TYPE_LABELS)}>
            {Object.entries(ITEM_TYPE_LABELS).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label>
          停留（分鐘）
          <input type="number" inputMode="numeric" min={5} max={600} step={5} value={stay} onChange={(e) => setStay(e.target.value)} />
        </label>
      </div>
      <div className="insert-buttons">
        <button className="ghost" type="button" onClick={onCancel}>
          取消
        </button>
        <button className="secondary" type="button" disabled={!valid} onClick={() => onAdd(name.trim(), type, stayMinutes)}>
          加入
        </button>
      </div>
    </li>
  );
}

export function DayEditor({
  tripId,
  date,
  rows,
  fixed,
  legs,
  canEdit,
  mode,
  otherDates,
  actions,
  heading,
  statusLabel,
  below,
}: {
  tripId: string;
  date: string;
  rows: EditorRow[];
  fixed: Array<{ name: string; start: string; end: string }>;
  legs: Record<string, EditorLeg>;
  canEdit: boolean;
  mode: EditMode;
  otherDates: Array<{ date: string; label: string }>;
  actions: ReactNode;
  heading: string;
  statusLabel: string;
  below: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [desired, setDesired] = useState<Desired[]>(() => fromRows(rows));
  const [removed, setRemoved] = useState<string[]>([]);
  const [shift, setShift] = useState(true);
  const [insertAfter, setInsertAfter] = useState<number | null>(null);
  const [state, action, pending] = useActionState<EditResult | null, FormData>(saveDayBatch, null);
  const [swapState, swapAction, swapPending] = useActionState<EditResult | null, FormData>(editItem, null);
  const listRef = useRef<HTMLOListElement>(null);
  const dragging = useRef<number | null>(null);
  const signature = rows.map((r) => `${r.itemId}@${r.start}-${r.end}`).join("|");

  // 伺服器資料更新（儲存成功、其他成員修改）時重設編輯內容
  useEffect(() => {
    setDesired(fromRows(rows));
    setRemoved([]);
    setInsertAfter(null);
  }, [signature]);

  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  const preview = useMemo(() => {
    const original = fromRows(rows);
    const changed = desired.findIndex((d, k) => {
      const o = original[k];
      return !o || o.itemId !== d.itemId || o.start !== d.start || o.stay !== d.stay;
    });
    const from = changed < 0 ? desired.length : changed;
    return shiftDay({
      items: desired.map((d) => ({ itemId: d.itemId, start: d.start, stayMinutes: d.stay })),
      fixed,
      travel: (a, b) => legGapMinutes(toLeg(legs[`${a}>${b}`])),
      from,
      shift,
    });
  }, [desired, rows, fixed, legs, shift]);

  const placementOf = (id: string) => preview.placements.find((p) => p.itemId === id);
  const nameOf = (id: string) => desired.find((d) => d.itemId === id)?.name ?? "";

  const move = (from: number, to: number) => {
    if (to < 0 || to >= desired.length || from === to) return;
    setDesired((current) => {
      const order = [...current];
      const [picked] = order.splice(from, 1);
      if (!picked) return current;
      order.splice(to, 0, picked);
      // 每個位置沿用該位置原本的開始時間（保留空檔），停留跟著項目
      const slots = current.map((d) => ({ itemId: d.itemId, start: d.start, end: toHhmm(Math.min(toMin(d.start) + d.stay, 23 * 60 + 59)) }));
      const { items } = reorderDesired(slots, order.map((d) => d.itemId));
      return items.map((it) => ({ ...(order.find((d) => d.itemId === it.itemId) as Desired), start: it.start, stay: it.stayMinutes }));
    });
  };

  const setStart = (index: number, value: string) => {
    if (!HHMM.test(value)) return;
    setDesired((current) => current.map((d, k) => (k === index ? { ...d, start: value } : d)));
  };
  const setEnd = (index: number, value: string) => {
    const item = desired[index];
    if (!item || !HHMM.test(value)) return;
    const start = placementOf(item.itemId)?.start ?? item.start;
    const stay = toMin(value) - toMin(start);
    if (stay < 5) return;
    setDesired((current) => current.map((d, k) => (k === index ? { ...d, start, stay } : d)));
  };

  const remove = (index: number) => {
    const item = desired[index];
    if (!item || !window.confirm(`刪除「${item.name}」？按「完成」後才會儲存。`)) return;
    if (!item.added) setRemoved((r) => [...r, item.itemId]);
    setDesired((current) => current.filter((_, k) => k !== index));
  };

  const insert = (after: number, name: string, type: keyof typeof ITEM_TYPE_LABELS, stay: number) => {
    const previous = desired[after];
    const anchor = previous ? (placementOf(previous.itemId)?.end ?? toHhmm(toMin(previous.start) + previous.stay)) : (desired[0]?.start ?? "10:00");
    const start = toMin(anchor) + stay > 23 * 60 + 59 ? toHhmm(Math.max(0, 23 * 60 + 59 - stay)) : anchor;
    const id = crypto.randomUUID();
    setDesired((current) => {
      const next = [...current];
      next.splice(after + 1, 0, { itemId: id, name, start, stay, added: { type } });
      return next;
    });
    setInsertAfter(null);
  };

  const cancel = () => {
    setDesired(fromRows(rows));
    setRemoved([]);
    setInsertAfter(null);
    setShift(true);
    setEditing(false);
  };

  // 拖曳：把手以 pointer capture 追蹤，依各列的垂直中線決定新位置（滑鼠與觸控相同）
  const onHandleDown = (index: number, event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = index;
  };
  const onHandleMove = (event: PointerEvent<HTMLButtonElement>) => {
    const from = dragging.current;
    const list = listRef.current;
    if (from === null || !list) return;
    const rowsEls = [...list.querySelectorAll<HTMLElement>("[data-edit-row]")];
    let target = rowsEls.length - 1;
    for (let k = 0; k < rowsEls.length; k += 1) {
      const rect = rowsEls[k]?.getBoundingClientRect();
      if (rect && event.clientY < rect.top + rect.height / 2) {
        target = k;
        break;
      }
    }
    if (target !== from) {
      move(from, target);
      dragging.current = target;
    }
  };
  const onHandleUp = () => {
    dragging.current = null;
  };
  const onHandleKey = (index: number, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const to = event.key === "ArrowUp" ? index - 1 : index + 1;
      move(index, to);
      requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLButtonElement>(".drag-handle")[to]?.focus());
    }
  };

  const batch = JSON.stringify({
    date,
    placements: preview.placements.filter((p) => !desired.find((d) => d.itemId === p.itemId)?.added),
    removed,
    added: desired.flatMap((d) => {
      const p = placementOf(d.itemId);
      return d.added && p
        ? [{ itemId: d.itemId, item: { name_zh: d.name, type: d.added.type, address: null, suggested_stay_minutes: d.stay, note: null, place_id: null }, start: p.start, end: p.end }]
        : [];
    }),
  });

  const fixedRows = fixed.map((f) => ({ kind: "fixed" as const, ...f }));
  const listed = editing
    ? []
    : [...rows.map((r) => ({ kind: "item" as const, ...r })), ...fixedRows].sort((a, b) => a.start.localeCompare(b.start));
  let previousItem: string | null = null;

  return (
    <>
      <div className="day-head">
        <h2>{heading}</h2>
        <span className="tag">{statusLabel}</span>
        {canEdit && !editing && rows.length > 0 ? (
          <button className="secondary day-edit" type="button" onClick={() => setEditing(true)}>
            編輯
          </button>
        ) : null}
      </div>
      {editing && EDIT_HINTS[mode] ? <p className="muted edit-hint">{EDIT_HINTS[mode]}</p> : null}
      {editing && fixed.length > 0 ? (
        <p className="muted edit-hint">固定活動（不移動）：{fixed.map((f) => `${f.start} ${f.name}`).join("、")}</p>
      ) : null}
      {!editing && rows.length === 0 && fixed.length === 0 ? <p className="muted">這天還沒有可排入的項目。</p> : null}
      <ScrollKeeper scrollKey={`days:${tripId}:${date}${editing ? ":edit" : ""}`}>
        {editing ? (
          <ol aria-label="編輯項目" className="rows edit-rows" ref={listRef}>
            {desired.map((d, index) => {
              const p = placementOf(d.itemId);
              const shifted = preview.moved.includes(d.itemId);
              const over = preview.overflow.includes(d.itemId);
              return [
                <li key={d.itemId} data-edit-row className={shifted ? "edit-row shifted" : "edit-row"}>
                  <div className="edit-line">
                    <button
                      className="ghost drag-handle"
                      type="button"
                      aria-label={`拖曳排序：${d.name}（可用上下鍵）`}
                      onPointerDown={(e) => onHandleDown(index, e)}
                      onPointerMove={onHandleMove}
                      onPointerUp={onHandleUp}
                      onPointerCancel={onHandleUp}
                      onKeyDown={(e) => onHandleKey(index, e)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 8h14M5 12h14M5 16h14" />
                      </svg>
                    </button>
                    <span className="edit-name">
                      {d.name}
                      {d.added ? <span className="tag">新增</span> : null}
                      {shifted ? <span className="tag">順延</span> : null}
                      {over ? <span className="tag risk">排不下</span> : null}
                    </span>
                    <button className="danger" type="button" aria-label={`刪除${d.name}`} onClick={() => remove(index)}>
                      刪除
                    </button>
                  </div>
                  <div className="edit-line edit-times">
                    <label>
                      <span className="sr-only">{d.name} 開始</span>
                      <input type="time" step={300} value={p?.start ?? d.start} onChange={(e) => setStart(index, e.target.value)} />
                    </label>
                    <label>
                      <span className="sr-only">{d.name} 結束</span>
                      <input type="time" step={300} value={p?.end ?? toHhmm(Math.min(toMin(d.start) + d.stay, 23 * 60 + 59))} onChange={(e) => setEnd(index, e.target.value)} />
                    </label>
                    <button className="secondary icon-button" type="button" aria-label={`上移${d.name}`} disabled={index === 0} onClick={() => move(index, index - 1)}>
                      ↑
                    </button>
                    <button className="secondary icon-button" type="button" aria-label={`下移${d.name}`} disabled={index === desired.length - 1} onClick={() => move(index, index + 1)}>
                      ↓
                    </button>
                    <button className="secondary icon-button" type="button" aria-label={`在${d.name}後面插入`} onClick={() => setInsertAfter(index)}>
                      ＋
                    </button>
                  </div>
                </li>,
                insertAfter === index ? (
                  <InsertForm key={`insert-${d.itemId}`} onAdd={(name, type, stay) => insert(index, name, type, stay)} onCancel={() => setInsertAfter(null)} />
                ) : null,
              ];
            })}
          </ol>
        ) : (
          <ol aria-label="項目" className="rows day-rows">
            {listed.map((entry) => {
              if (entry.kind === "fixed") {
                return (
                  <li key={`${entry.name}-${entry.start}`}>
                    <div className="row">
                      <span className="row-time">{entry.start}</span>
                      <span className="row-name">{entry.name}</span>
                      <span className="row-meta">固定活動</span>
                    </div>
                  </li>
                );
              }
              const before = previousItem;
              previousItem = entry.itemId;
              return [
                before ? <TravelLeg key={`leg-${before}-${entry.itemId}`} tripId={tripId} from={before} to={entry.itemId} leg={legs[`${before}>${entry.itemId}`]} canEdit={canEdit} /> : null,
                <li key={entry.itemId}>
                  <Link href={`/trips/${tripId}/items/${entry.itemId}?date=${date}`}>
                    <span className="row-time">{entry.start}</span>
                    <span className="row-name">{entry.name}</span>
                    <span className={entry.risk ? "row-meta risk" : "row-meta"}>{entry.meta}</span>
                  </Link>
                </li>,
              ];
            })}
          </ol>
        )}
      </ScrollKeeper>
      {editing ? null : below}
      {editing ? (
        <div className="edit-tools">
          <label className="no-shift">
            <input type="checkbox" checked={!shift} onChange={(e) => setShift(!e.target.checked)} />
            不要順延
          </label>
          {preview.overflow.length > 0 ? (
            <p className="error">排不下：{preview.overflow.map(nameOf).join("、")}。請刪除或提早時間。</p>
          ) : preview.moved.length > 0 ? (
            <p className="muted">已順延：{preview.moved.map(nameOf).join("、")}</p>
          ) : null}
          {otherDates.length > 0 ? (
            <form
              action={swapAction}
              className="swap-form"
              onSubmit={(event) => {
                const other = (event.currentTarget.elements.namedItem("other") as HTMLSelectElement | null)?.value ?? "";
                const label = otherDates.find((o) => o.date === other)?.label ?? other;
                if (!window.confirm(`把這天的所有項目與 ${label} 整天交換？`)) event.preventDefault();
              }}
            >
              <input type="hidden" name="tripId" value={tripId} />
              <input type="hidden" name="kind" value="swap" />
              <input type="hidden" name="date" value={date} />
              <label>
                <span className="sr-only">交換的日期</span>
                <select name="other" defaultValue={otherDates[0]?.date}>
                  {otherDates.map((o) => (
                    <option key={o.date} value={o.date}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="secondary" type="submit" disabled={swapPending}>
                整天交換
              </button>
            </form>
          ) : null}
          {swapState ? (
            <p role="status" className={swapState.ok ? undefined : "error"}>
              {swapState.message}
            </p>
          ) : null}
        </div>
      ) : null}
      {state ? (
        <p role="status" className={state.ok ? "edit-result" : "edit-result error"}>
          {state.message}
          {state.ok && state.mode === "proposal" ? (
            <>
              {" "}
              <Link href={`/trips/${tripId}/proposals`}>查看提案</Link>
            </>
          ) : null}
          {state.ok && state.warnings.length > 0 ? `（提醒：${state.warnings.join("、")}）` : null}
        </p>
      ) : null}
      {editing ? (
        <form action={action} className="screen-actions edit-actions">
          <input type="hidden" name="tripId" value={tripId} />
          <input type="hidden" name="batch" value={batch} />
          <button key="cancel-edit" className="ghost" type="button" onClick={cancel}>
            取消
          </button>
          <button key="save-edit" className="primary" type="submit" disabled={pending || preview.overflow.length > 0}>
            {pending ? "儲存中…" : mode === "proposal" ? "完成並提出" : "完成"}
          </button>
        </form>
      ) : (
        actions
      )}
    </>
  );
}
