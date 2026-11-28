import type { Metadata } from "next";
import { loadBookings } from "../../../../../lib/server/bookings";
import { BookingFormScreen } from "../form-page";
import { NotAvailable } from "../parts";
import "../bookings.css";

export const metadata: Metadata = { title: "新增預訂" };
export const dynamic = "force-dynamic";

export default async function NewBookingPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const view = await loadBookings(tripId);
  if (view.state !== "ok") return <NotAvailable title="新增預訂" state={view.state} />;
  return <BookingFormScreen view={view} bookingId={null} />;
}
