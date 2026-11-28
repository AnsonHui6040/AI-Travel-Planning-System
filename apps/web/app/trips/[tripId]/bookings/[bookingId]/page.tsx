import type { Metadata } from "next";
import Link from "next/link";
import { KIND_LABELS, bookingRange } from "../../../../../lib/booking-format";
import { loadBookings } from "../../../../../lib/server/bookings";
import { DeleteBookingButton } from "../booking-forms";
import { BackLink, BookingRows, NotAvailable } from "../parts";
import "../bookings.css";

// 預訂詳情：時間、地點、預約碼、備註、關聯項目；修改另開畫面，刪除先確認。1024px 以上左清單、右詳情

export const metadata: Metadata = { title: "預訂詳情" };
export const dynamic = "force-dynamic";

export default async function BookingDetailPage({ params }: { params: Promise<{ tripId: string; bookingId: string }> }) {
  const { tripId, bookingId } = await params;
  const view = await loadBookings(tripId);
  if (view.state !== "ok") return <NotAvailable title="預訂詳情" state={view.state} />;
  const base = `/trips/${tripId}/bookings`;
  const b = view.bookings.find((x) => x.id === bookingId);
  return (
    <main className="screen wide bookings">
      <header className="screen-head">
        <BackLink href={base} label="預訂" />
        <h1>{b ? b.title : "預訂詳情"}</h1>
      </header>
      <div className="split" data-detail="open">
        <section aria-label="預訂清單" className="split-list">
          <BookingRows view={view} currentId={bookingId} />
        </section>
        <div className="split-detail">
          {b ? (
            <>
              <section aria-label="預訂詳情" className="screen-body">
                <p className="booking-kind">{KIND_LABELS[b.kind]}</p>
                <p className="booking-time">{bookingRange(b, view.timezone)}</p>
                <dl className="booking-facts">
                  <dt>預約碼</dt>
                  <dd className="booking-code">{b.confirmationCode ?? "未填"}</dd>
                  {b.location ? (
                    <>
                      <dt>地點</dt>
                      <dd>{b.location}</dd>
                    </>
                  ) : null}
                  {b.itemName ? (
                    <>
                      <dt>項目</dt>
                      <dd>{b.itemName}</dd>
                    </>
                  ) : null}
                  {b.note ? (
                    <>
                      <dt>備註</dt>
                      <dd>{b.note}</dd>
                    </>
                  ) : null}
                </dl>
              </section>
              {view.canEdit ? (
                <div className="screen-actions">
                  <Link className="secondary" href={`${base}/${b.id}/edit`}>
                    修改
                  </Link>
                  <DeleteBookingButton tripId={tripId} bookingId={b.id} title={b.title} />
                </div>
              ) : null}
            </>
          ) : (
            <p>找不到這筆預訂。</p>
          )}
        </div>
      </div>
    </main>
  );
}
