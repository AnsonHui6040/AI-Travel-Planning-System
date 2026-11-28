import type { Metadata } from "next";
import { loadBookings } from "../../../../../../lib/server/bookings";
import { BookingFormScreen } from "../../form-page";
import { NotAvailable } from "../../parts";
import "../../bookings.css";

export const metadata: Metadata = { title: "修改預訂" };
export const dynamic = "force-dynamic";

export default async function EditBookingPage({ params }: { params: Promise<{ tripId: string; bookingId: string }> }) {
  const { tripId, bookingId } = await params;
  const view = await loadBookings(tripId);
  if (view.state !== "ok") return <NotAvailable title="修改預訂" state={view.state} />;
  return <BookingFormScreen view={view} bookingId={bookingId} />;
}
