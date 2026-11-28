"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ITEM_TYPE_LABELS } from "../../../../lib/item-labels";
import type { EditResult } from "../../../../lib/server/item-edit-core";
import { editItem } from "./actions";

// 決策 0010 E：新增地點、修改與排程的表單。輸入欄不受控（React 19 在 Server Action 後重設 form）

const shortDate = (date: string) =>
  new Intl.DateTimeFormat("zh-TW", { timeZone: "UTC", month: "numeric", day: "numeric", weekday: "short" }).format(new Date(`${date}T00:00:00Z`));

function Status({ state, tripId }: { state: EditResult | null; tripId: string }) {
  if (!state) return null;
  return (
    <div role="status" className={state.ok ? "edit-status" : "edit-status error"}>
      <p>
        {state.message}
        {state.ok && state.itemId && state.mode === "direct" ? (
          <>
            {" "}
            <Link href={`/trips/${tripId}/items/${state.itemId}/edit`}>查看</Link>
          </>
        ) : null}
        {state.ok && state.mode === "proposal" ? (
          <>
            {" "}
            <Link href={`/trips/${tripId}/proposals`}>查看提案</Link>
          </>
        ) : null}
      </p>
      {state.ok && state.warnings.length > 0 ? (
        <ul aria-label="提醒" className="edit-warnings">
          {state.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TypeAndStay({ type, stay }: { type?: string; stay?: number }) {
  return (
    <div className="field-pair">
      <label>
        類型
        <select name="type" defaultValue={type ?? "attraction"}>
          {Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        停留（分鐘）
        <input name="suggested_stay_minutes" type="number" inputMode="numeric" min={5} max={600} step={5} defaultValue={stay ?? 60} required />
      </label>
    </div>
  );
}

function MoreFields({ address, note }: { address?: string | null; note?: string | null }) {
  return (
    <details className="more-fields">
      <summary>地址與備註</summary>
      <label>
        地址
        <input name="address" maxLength={200} defaultValue={address ?? ""} autoComplete="off" />
      </label>
      <label>
        備註
        <textarea name="note" maxLength={500} rows={2} defaultValue={note ?? ""} />
      </label>
    </details>
  );
}

export function AddItemForm({
  tripId,
  dates,
  defaultName,
  placeId,
  mode,
}: {
  tripId: string;
  dates: string[];
  defaultName: string;
  placeId: string | null;
  mode: "direct" | "proposal";
}) {
  const [state, action, pending] = useActionState(editItem, null);
  return (
    <form action={action} className="screen-form item-form">
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="kind" value="add" />
      {placeId ? <input type="hidden" name="place_id" value={placeId} /> : null}
      <label>
        名稱
        <input name="name_zh" maxLength={80} required defaultValue={defaultName} autoComplete="off" />
      </label>
      <TypeAndStay />
      <div className="field-pair">
        <label>
          日期
          <select name="date" defaultValue="">
            <option value="">候選清單</option>
            {dates.map((d) => (
              <option key={d} value={d}>
                {shortDate(d)}
              </option>
            ))}
          </select>
        </label>
        <label>
          開始
          <input name="start" type="time" step={300} />
        </label>
      </div>
      <MoreFields />
      <Status state={state} tripId={tripId} />
      <div className="screen-actions">
        <button className="primary" type="submit" disabled={pending}>
          {pending ? "儲存中…" : mode === "proposal" ? "提出新增" : "新增"}
        </button>
      </div>
    </form>
  );
}

export function EditItemForm({
  tripId,
  item,
  mode,
}: {
  tripId: string;
  item: { id: string; nameZh: string; type: string; stayMinutes: number; address: string | null; note: string | null };
  mode: "direct" | "proposal";
}) {
  const [state, action, pending] = useActionState(editItem, null);
  return (
    <form action={action} className="screen-form item-form">
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="kind" value="update" />
      <input type="hidden" name="itemId" value={item.id} />
      <label>
        名稱
        <input name="name_zh" maxLength={80} required defaultValue={item.nameZh} autoComplete="off" />
      </label>
      <TypeAndStay type={item.type} stay={item.stayMinutes} />
      <MoreFields address={item.address} note={item.note} />
      <Status state={state} tripId={tripId} />
      <div className="screen-actions">
        <button className="primary" type="submit" disabled={pending}>
          {pending ? "儲存中…" : mode === "proposal" ? "提出修改" : "儲存"}
        </button>
      </div>
    </form>
  );
}

export function ScheduleControls({
  tripId,
  itemId,
  itemName,
  dates,
  current,
  canMoveUp,
  canMoveDown,
  canSchedule,
}: {
  tripId: string;
  itemId: string;
  itemName: string;
  dates: string[];
  current: { date: string; start: string; end: string } | null;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canSchedule: boolean;
}) {
  const [state, action, pending] = useActionState(editItem, null);
  return (
    <form
      action={action}
      className="schedule-controls"
      onSubmit={(event) => {
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        if (submitter?.value === "delete" && !window.confirm(`刪除「${itemName}」？刪除後無法復原。`)) event.preventDefault();
      }}
    >
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="itemId" value={itemId} />
      <fieldset disabled={pending}>
        <legend className="sr-only">排程</legend>
        {current ? (
          <div className="button-row">
            <button key="up" className="secondary" type="submit" name="kind" value="up" disabled={!canMoveUp}>
              上移
            </button>
            <button key="down" className="secondary" type="submit" name="kind" value="down" disabled={!canMoveDown}>
              下移
            </button>
            <button key="unschedule" className="secondary" type="submit" name="kind" value="unschedule">
              移回候選清單
            </button>
            <button key="duplicate" className="secondary" type="submit" name="kind" value="duplicate">
              複製
            </button>
            <button key="delete" className="danger" type="submit" name="kind" value="delete">
              刪除
            </button>
          </div>
        ) : (
          <div className="button-row">
            <button key="delete-candidate" className="danger" type="submit" name="kind" value="delete">
              刪除
            </button>
          </div>
        )}
        {canSchedule ? (
          <div className="form-grid move-row">
            <label className="move-date">
              {current ? "日期" : "排入"}
              <select name="date" defaultValue={current?.date ?? dates[0]}>
                {dates.map((d) => (
                  <option key={d} value={d}>
                    {shortDate(d)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              開始
              <input name="start" type="time" step={300} defaultValue={current?.start ?? "10:00"} />
            </label>
            <label>
              結束
              <input name="end" type="time" step={300} defaultValue={current?.end ?? ""} />
            </label>
            <button key="move" className="secondary" type="submit" name="kind" value="move">
              {current ? "改時間" : "排入"}
            </button>
          </div>
        ) : null}
      </fieldset>
      <Status state={state} tripId={tripId} />
    </form>
  );
}
