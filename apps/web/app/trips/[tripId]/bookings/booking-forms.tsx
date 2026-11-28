"use client";

import { BOOKING_KINDS, type BookingKind } from "@atps/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { KIND_LABELS, timezoneLabel } from "../../../../lib/booking-format";
import type { BookingActionResult } from "../../../../lib/server/bookings-core";
import { deleteBooking, saveBooking } from "./actions";

// 決策 0010 B：預訂的表單。受控欄位不放在以 action 送出的 <form> 內（React 19 會在 Server Action 後重設表單），
// 改由 onSubmit 呼叫 Server Action。時間以選擇的時區輸入；伺服器與資料庫再檢查一次

export interface BookingFormInitial {
  kind: BookingKind;
  title: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timezone: string;
  location: string;
  confirmationCode: string;
  note: string;
  itemId: string;
}

function Status({ result }: { result: BookingActionResult | null }) {
  return result ? (
    <p role="status" className={result.ok ? "ok" : "error"}>
      {result.message}
    </p>
  ) : null;
}

export function BookingForm({
  tripId,
  bookingId,
  initial,
  items,
  timezones,
  cancelHref,
}: {
  tripId: string;
  bookingId: string | null;
  initial: BookingFormInitial;
  items: Array<{ id: string; name: string }>;
  timezones: string[];
  cancelHref: string;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [result, setResult] = useState<BookingActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof BookingFormInitial>(key: K, value: BookingFormInitial[K]) => setV((prev) => ({ ...prev, [key]: value }));
  const lodging = v.kind === "lodging";

  return (
    <form
      aria-label={bookingId ? "修改預訂" : "新增預訂"}
      className="screen-form booking-form"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const r = await saveBooking({ tripId, bookingId, ...v });
          setResult(r);
          if (r.ok && r.id) router.push(`/trips/${tripId}/bookings/${r.id}`);
        });
      }}
    >
      <div className="screen-body">
        <div className="fields">
          <label className="field">
            類型
            <select value={v.kind} onChange={(e) => set("kind", e.target.value as BookingKind)}>
              {BOOKING_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            時區
            <select value={v.timezone} onChange={(e) => set("timezone", e.target.value)}>
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {timezoneLabel(tz)}
                </option>
              ))}
            </select>
          </label>
          <label className="field wide">
            標題
            <input required maxLength={80} autoComplete="off" value={v.title} onChange={(e) => set("title", e.target.value)} />
          </label>
          <label className="field">
            {lodging ? "入住日期" : "開始日期"}
            <input type="date" required value={v.startDate} onChange={(e) => set("startDate", e.target.value)} />
          </label>
          <label className="field">
            {lodging ? "入住時間" : "開始時間"}
            <input type="time" required value={v.startTime} onChange={(e) => set("startTime", e.target.value)} />
          </label>
          <label className="field">
            {lodging ? "退房日期" : "結束日期"}
            <input type="date" value={v.endDate} onChange={(e) => set("endDate", e.target.value)} />
          </label>
          <label className="field">
            {lodging ? "退房時間" : "結束時間"}
            <input type="time" value={v.endTime} onChange={(e) => set("endTime", e.target.value)} />
          </label>
          <label className="field">
            地點
            <input maxLength={200} autoComplete="off" value={v.location} onChange={(e) => set("location", e.target.value)} />
          </label>
          <label className="field">
            預約碼
            <input maxLength={60} autoComplete="off" spellCheck={false} value={v.confirmationCode} onChange={(e) => set("confirmationCode", e.target.value)} />
          </label>
          <label className="field">
            關聯項目
            <select value={v.itemId} onChange={(e) => set("itemId", e.target.value)}>
              <option value="">不關聯</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            備註
            <input maxLength={500} autoComplete="off" value={v.note} onChange={(e) => set("note", e.target.value)} />
          </label>
        </div>
        <p className="muted booking-hint">預約碼只有行程成員看得到，不會送給 AI，也不會出現在唯讀連結。</p>
        <Status result={result} />
      </div>
      <div className="screen-actions">
        <Link className="secondary" href={cancelHref}>
          取消
        </Link>
        <button className="primary" type="submit" disabled={pending}>
          儲存
        </button>
      </div>
    </form>
  );
}

export function DeleteBookingButton({ tripId, bookingId, title }: { tripId: string; bookingId: string; title: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<BookingActionResult | null>(null);
  return (
    <>
      <button
        className="danger"
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`刪除預訂「${title}」？刪除後無法復原。`)) return;
          startTransition(async () => {
            const r = await deleteBooking(tripId, bookingId);
            setResult(r);
            if (r.ok) router.push(`/trips/${tripId}/bookings`);
          });
        }}
      >
        刪除
      </button>
      {result && !result.ok ? <Status result={result} /> : null}
    </>
  );
}
