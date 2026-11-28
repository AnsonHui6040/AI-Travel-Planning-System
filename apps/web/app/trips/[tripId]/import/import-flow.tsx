"use client";

import { BOOKING_KINDS, type BookingKind, type ImportBookingRow, type ImportPlaceRow, type ImportPreview } from "@atps/core";
import Link from "next/link";
import { useState, useTransition } from "react";
import { KIND_LABELS, timezoneLabel } from "../../../../lib/booking-format";
import { ITEM_TYPE_LABELS } from "../../../../lib/item-labels";
import type { ImportConfirmResult } from "../../../../lib/server/import-confirm-core";
import { previewImportText } from "./actions";
import { confirmImportRows } from "./confirm-actions";

// 決策 0010 I：貼上（第一個畫面）→ 預覽（第二個畫面，逐項修改、取消勾選）→ 加入（以本人 session 寫入）。
// 預覽只存在這個畫面的狀態（不保存、不放網址），預約碼只顯示給本人。受控欄位不放在以 action 送出的 <form> 內。
// 換畫面時切換的按鈕給不同 key（React 重用同一個 button 改成 submit 會直接送出）

type Step = "paste" | "preview" | "done";
type Notice = { kind: "error" | "no_key" | "empty"; message: string } | null;
type Selected = { list: "bookings"; key: string } | { list: "places"; key: string } | null;

const ITEM_TYPES = Object.keys(ITEM_TYPE_LABELS) as Array<keyof typeof ITEM_TYPE_LABELS>;

function Back({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button className="ghost back-link" type="button" onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M15 5l-7 7 7 7" />
      </svg>
      {label}
    </button>
  );
}

const shortDate = (date: string) => (date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}` : "");

export function ImportFlow({
  tripId,
  tripName,
  locked,
  dates,
  timezones,
}: {
  tripId: string;
  tripName: string;
  locked: boolean;
  dates: string[];
  timezones: string[];
}) {
  const [step, setStep] = useState<Step>("paste");
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Selected>(null);
  const [result, setResult] = useState<ImportConfirmResult | null>(null);
  const [pending, startTransition] = useTransition();

  const count = preview ? preview.bookings.filter((b) => b.selected).length + preview.places.filter((p) => p.selected).length : 0;
  const tzOptions = (tz: string) => (timezones.includes(tz) ? timezones : [tz, ...timezones]);

  const updateBooking = (key: string, patch: Partial<ImportBookingRow>) =>
    setPreview((p) => (p ? { ...p, bookings: p.bookings.map((b) => (b.key === key ? { ...b, ...patch } : b)) } : p));
  const updatePlace = (key: string, patch: Partial<ImportPlaceRow>) =>
    setPreview((p) => (p ? { ...p, places: p.places.map((r) => (r.key === key ? { ...r, ...patch } : r)) } : p));

  if (step === "paste") {
    return (
      <main className="screen import">
        <header className="screen-head">
          <Link className="back-link" href={`/trips/${tripId}/more`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            更多
          </Link>
          <h1>匯入</h1>
          <p>{tripName}</p>
        </header>
        <div className="screen-body import-paste">
          <label className="import-text">
            貼上確認信、其他 App 匯出的行程或自己的清單
            <textarea value={text} maxLength={50_000} spellCheck={false} onChange={(e) => setText(e.target.value)} />
          </label>
          <p className="muted import-hint">
            以你的 AI 設定與 key 整理成預訂與地點，你確認後才會加入。全名、電話、電子郵件會先移除，不送給 AI。
          </p>
          {notice ? (
            <div role="status" className={notice.kind === "empty" ? "import-notice" : "import-notice error"}>
              <p>{notice.message}</p>
              {notice.kind === "no_key" ? (
                <p className="import-links">
                  <Link href="/settings/api-keys">API key</Link>
                  <Link href="/settings/ai">AI 設定</Link>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="screen-actions">
          <button
            key="parse"
            className="primary"
            type="button"
            disabled={pending || text.trim() === ""}
            onClick={() =>
              startTransition(async () => {
                setNotice(null);
                const r = await previewImportText({ tripId, text });
                if (r.state === "ok") {
                  setPreview(r.preview);
                  setSelected(null);
                  setStep("preview");
                } else setNotice({ kind: r.state === "no_key" ? "no_key" : r.state === "empty" ? "empty" : "error", message: r.message });
              })
            }
          >
            {pending ? "整理中…" : "整理"}
          </button>
        </div>
      </main>
    );
  }

  if (step === "done" && result) {
    return (
      <main className="screen import">
        <header className="screen-head">
          <h1>匯入完成</h1>
          <p>{tripName}</p>
        </header>
        <div className="screen-body">
          <p role="status">{result.message}</p>
          {result.failures.length > 0 ? (
            <ul aria-label="沒有加入的項目" className="rows">
              {result.failures.map((f) => (
                <li key={f.key}>
                  <div className="row">
                    <span className="row-time">未加入</span>
                    <span className="row-name">{f.label}</span>
                    <span className="row-meta risk">{f.message}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="screen-actions">
          <Link className="secondary" href={`/trips/${tripId}/bookings`}>
            預訂
          </Link>
          <Link className="primary" href={`/trips/${tripId}/${locked ? "proposals" : "days"}`}>
            {locked ? "查看提案" : "查看行程"}
          </Link>
        </div>
      </main>
    );
  }

  if (!preview) return null;
  const booking = selected?.list === "bookings" ? preview.bookings.find((b) => b.key === selected.key) : undefined;
  const place = selected?.list === "places" ? preview.places.find((p) => p.key === selected.key) : undefined;
  const close = () => setSelected(null);

  return (
    <main className="screen wide import">
      <header className="screen-head">
        <Back
          label="重新貼上"
          onClick={() => {
            setStep("paste");
            setResult(null);
          }}
        />
        <h1>確認匯入</h1>
        <p>{locked ? "行程已鎖定：預訂直接加入，地點會成為待批准提案。" : "勾選要加入的項目，點項目可以修改。"}</p>
      </header>
      <div className="split" data-detail={booking || place ? "open" : "none"}>
        <section aria-label="匯入項目" className="split-list">
          <div className="scroll-area">
            {preview.bookings.length > 0 ? <h2>預訂</h2> : null}
            <ul aria-label="預訂" className="rows import-rows">
              {preview.bookings.map((b) => (
                <li key={b.key}>
                  <div className="row">
                    <input
                      type="checkbox"
                      aria-label={`加入 ${b.title}`}
                      checked={b.selected}
                      onChange={(e) => updateBooking(b.key, { selected: e.target.checked })}
                    />
                    <button className="ghost import-open" type="button" aria-current={selected?.key === b.key ? "true" : undefined} onClick={() => setSelected({ list: "bookings", key: b.key })}>
                      <span className="row-name">{b.title}</span>
                      <span className={b.issue ? "row-meta risk" : "row-meta"}>{b.issue ?? `${KIND_LABELS[b.kind]} ${shortDate(b.startDate)} ${b.startTime}`}</span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {preview.places.length > 0 ? <h2>地點</h2> : null}
            <ul aria-label="地點" className="rows import-rows">
              {preview.places.map((p) => (
                <li key={p.key}>
                  <div className="row">
                    <input type="checkbox" aria-label={`加入 ${p.name}`} checked={p.selected} onChange={(e) => updatePlace(p.key, { selected: e.target.checked })} />
                    <button className="ghost import-open" type="button" aria-current={selected?.key === p.key ? "true" : undefined} onClick={() => setSelected({ list: "places", key: p.key })}>
                      <span className="row-name">{p.name}</span>
                      <span className={p.issue ? "row-meta risk" : "row-meta"}>{p.issue ?? (p.date ? `${shortDate(p.date)} ${p.start}` : "候選清單")}</span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          {result && !result.ok ? (
            <p role="status" className="error">
              {result.message}
            </p>
          ) : null}
          <div className="screen-actions">
            <button
              key="confirm"
              className="primary"
              type="button"
              disabled={pending || count === 0}
              onClick={() =>
                startTransition(async () => {
                  const r = await confirmImportRows({
                    tripId,
                    bookings: preview.bookings.filter((b) => b.selected).map(({ selected: _s, issue: _i, ...row }) => row),
                    places: preview.places.filter((p) => p.selected).map(({ selected: _s, issue: _i, ...row }) => row),
                  });
                  setResult(r);
                  // 全部加入或部分加入都到完成畫面；完全沒有加入時留在預覽，可修改後再試
                  if (r.ok || r.failures.length < count) setStep("done");
                })
              }
            >
              {pending ? "加入中…" : `加入 ${count} 項`}
            </button>
          </div>
        </section>
        <section aria-label="項目詳情" className="split-detail">
          {booking ? (
            <div className="import-detail">
              <Back label="匯入項目" onClick={close} />
              <h2>修改預訂</h2>
              <div className="import-fields">
                <label>
                  類型
                  <select value={booking.kind} onChange={(e) => updateBooking(booking.key, { kind: e.target.value as BookingKind })}>
                    {BOOKING_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  時區
                  <select value={booking.timezone} onChange={(e) => updateBooking(booking.key, { timezone: e.target.value })}>
                    {tzOptions(booking.timezone).map((tz) => (
                      <option key={tz} value={tz}>
                        {timezoneLabel(tz)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="wide">
                  標題
                  <input maxLength={80} autoComplete="off" value={booking.title} onChange={(e) => updateBooking(booking.key, { title: e.target.value })} />
                </label>
                <label>
                  開始日期
                  <input type="date" value={booking.startDate} onChange={(e) => updateBooking(booking.key, { startDate: e.target.value })} />
                </label>
                <label>
                  開始時間
                  <input type="time" value={booking.startTime} onChange={(e) => updateBooking(booking.key, { startTime: e.target.value, issue: null })} />
                </label>
                <label>
                  結束日期
                  <input type="date" value={booking.endDate} onChange={(e) => updateBooking(booking.key, { endDate: e.target.value })} />
                </label>
                <label>
                  結束時間
                  <input type="time" value={booking.endTime} onChange={(e) => updateBooking(booking.key, { endTime: e.target.value })} />
                </label>
                <label>
                  地點
                  <input maxLength={200} autoComplete="off" value={booking.location} onChange={(e) => updateBooking(booking.key, { location: e.target.value })} />
                </label>
                <label>
                  預約碼
                  <input maxLength={60} autoComplete="off" spellCheck={false} value={booking.confirmationCode} onChange={(e) => updateBooking(booking.key, { confirmationCode: e.target.value })} />
                </label>
                <label className="wide">
                  備註
                  <input maxLength={500} autoComplete="off" value={booking.note} onChange={(e) => updateBooking(booking.key, { note: e.target.value })} />
                </label>
              </div>
              <div className="screen-actions import-detail-actions">
                <button key="done-booking" className="secondary" type="button" onClick={close}>
                  完成
                </button>
              </div>
            </div>
          ) : place ? (
            <div className="import-detail">
              <Back label="匯入項目" onClick={close} />
              <h2>修改地點</h2>
              <div className="import-fields">
                <label className="wide">
                  名稱
                  <input maxLength={80} autoComplete="off" value={place.name} onChange={(e) => updatePlace(place.key, { name: e.target.value })} />
                </label>
                <label>
                  類型
                  <select value={place.type} onChange={(e) => updatePlace(place.key, { type: e.target.value as ImportPlaceRow["type"] })}>
                    {ITEM_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {ITEM_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  停留（分鐘）
                  <input type="number" min={5} max={600} step={5} value={place.stayMinutes} onChange={(e) => updatePlace(place.key, { stayMinutes: Number(e.target.value) || 0 })} />
                </label>
                <label>
                  日期
                  <select
                    value={place.date}
                    onChange={(e) => updatePlace(place.key, { date: e.target.value, start: e.target.value ? place.start || "10:00" : "", issue: null })}
                  >
                    <option value="">候選清單</option>
                    {dates.map((d) => (
                      <option key={d} value={d}>
                        {shortDate(d)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  開始時間
                  <input type="time" disabled={place.date === ""} value={place.start} onChange={(e) => updatePlace(place.key, { start: e.target.value })} />
                </label>
                <label className="wide">
                  備註
                  <input maxLength={500} autoComplete="off" value={place.note} onChange={(e) => updatePlace(place.key, { note: e.target.value })} />
                </label>
              </div>
              <p className="muted import-hint">來源為「使用者新增」，狀態為「使用者確認」。</p>
              <div className="screen-actions import-detail-actions">
                <button key="done-place" className="secondary" type="button" onClick={close}>
                  完成
                </button>
              </div>
            </div>
          ) : (
            <p className="empty-detail">點一個項目修改時間、地點或預約碼；取消勾選的項目不會加入。</p>
          )}
        </section>
      </div>
    </main>
  );
}
