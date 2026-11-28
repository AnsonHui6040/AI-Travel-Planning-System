import Link from "next/link";
import { ScrollKeeper } from "../../../../components/scroll-keeper";
import { KIND_LABELS, shortWhen } from "../../../../lib/booking-format";
import type { BookingsView } from "../../../../lib/server/bookings";

// 決策 0010 B：預訂與清單畫面共用的部分（伺服器元件）

export type OkBookings = Extract<BookingsView, { state: "ok" }>;

const UNAVAILABLE = { signed_out: "請先登入。", not_found: "找不到這個行程，或你不是成員。" } as const;

export function NotAvailable({ title, state }: { title: string; state: keyof typeof UNAVAILABLE }) {
  return (
    <main className="screen bookings">
      <h1>{title}</h1>
      <p>{UNAVAILABLE[state]}</p>
    </main>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link className="back-link" href={href}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M15 5l-7 7 7 7" />
      </svg>
      {label}
    </Link>
  );
}

export const READ_ONLY = "只有 Owner 與 Companion 可以修改；你可以檢視。";

// 預訂與基線內的航班、住宿（唯讀）依開始時間排在一起；每項一行
export function BookingRows({ view, currentId }: { view: OkBookings; currentId: string | null }) {
  const rows = [
    ...view.bookings.map((b) => ({ key: b.id, at: Date.parse(b.starts_at), booking: b, base: null })),
    ...view.baseline.map((b) => ({ key: b.key, at: Date.parse(b.startsAt.length > 16 ? b.startsAt : `${b.startsAt}:00Z`), booking: null, base: b })),
  ].sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
  return (
    <ScrollKeeper scrollKey={`bookings:${view.tripId}`}>
      {rows.length === 0 ? <p className="muted">還沒有預訂。</p> : null}
      <ul aria-label="預訂" className="rows booking-rows">
        {rows.map(({ key, booking, base }) => {
          if (booking) {
            const when = shortWhen(booking.starts_at, booking.timezone);
            return (
              <li key={key}>
                <Link href={`/trips/${view.tripId}/bookings/${booking.id}`} aria-current={booking.id === currentId ? "page" : undefined}>
                  <span className="row-time booking-when">
                    <span>{when.date}</span>
                    <span>{when.time}</span>
                  </span>
                  <span className="row-name">{booking.title}</span>
                  <span className="row-meta">{KIND_LABELS[booking.kind]}</span>
                </Link>
              </li>
            );
          }
          if (!base) return null;
          const when =
            base.kind === "flight"
              ? shortWhen(base.startsAt, view.timezone)
              : { date: `${Number(base.startsAt.slice(5, 7))}/${Number(base.startsAt.slice(8, 10))}`, time: base.startsAt.slice(11, 16) };
          return (
            <li key={key}>
              <div className="row">
                <span className="row-time booking-when">
                  <span>{when.date}</span>
                  <span>{when.time}</span>
                </span>
                <span className="row-name">{base.title}</span>
                <span className="row-meta">{KIND_LABELS[base.kind]}（旅行基線）</span>
              </div>
            </li>
          );
        })}
      </ul>
    </ScrollKeeper>
  );
}
