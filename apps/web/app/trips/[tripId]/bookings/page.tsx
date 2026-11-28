import type { Metadata } from "next";
import Link from "next/link";
import { loadBookings } from "../../../../lib/server/bookings";
import { BookingRows, NotAvailable, READ_ONLY } from "./parts";
import "./bookings.css";

// 決策 0010 B：預訂清單（航班、住宿、餐廳、票券、交通、其他）。每項一行，詳情另開；1024px 以上左清單、右詳情。
// 旅行基線內的航班與住宿以唯讀列出（沒有預約碼），已有同一時間的預訂時不重複

export const metadata: Metadata = { title: "預訂" };
export const dynamic = "force-dynamic";

export default async function BookingsPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const view = await loadBookings(tripId);
  if (view.state !== "ok") return <NotAvailable title="預訂" state={view.state} />;
  return (
    <main className="screen wide bookings">
      <header className="screen-head">
        <h1>預訂</h1>
        <p>
          {view.tripName}，{view.bookings.length} 筆
        </p>
      </header>
      <div className="split" data-detail="none">
        <section aria-label="預訂清單" className="split-list">
          <BookingRows view={view} currentId={null} />
          <div className="screen-actions">
            {view.canEdit ? (
              <Link className="primary" href={`/trips/${tripId}/bookings/new`}>
                新增預訂
              </Link>
            ) : (
              <p className="muted">{READ_ONLY}</p>
            )}
          </div>
        </section>
        <div className="split-detail">
          <p className="empty-detail">選擇一筆預訂查看時間、地點與預約碼。</p>
        </div>
      </div>
    </main>
  );
}
