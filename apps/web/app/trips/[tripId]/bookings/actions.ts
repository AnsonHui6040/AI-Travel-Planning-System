"use server";

import { revalidatePath } from "next/cache";
import { deleteBookingAction, saveBookingAction, type BookingActionResult } from "../../../../lib/server/bookings-core";
import { bookingActionDeps } from "../../../../lib/server/bookings";

// 決策 0010 B：預訂。Next.js 對 Server Action 比對 Origin 與 Host；登入與速率限制在 bookings-core 內檢查（C-11）。
// 預訂會改變當天的固定活動，行程與「現在」一併更新

const refresh = (tripId: unknown, result: BookingActionResult) => {
  if (result.ok && typeof tripId === "string") {
    revalidatePath(`/trips/${tripId}/bookings`, "layout");
    revalidatePath(`/trips/${tripId}/days`);
    revalidatePath(`/trips/${tripId}/today`);
  }
  return result;
};

const tripOf = (input: unknown) => (input && typeof input === "object" ? (input as { tripId?: unknown }).tripId : undefined);

export async function saveBooking(input: unknown): Promise<BookingActionResult> {
  return refresh(tripOf(input), await saveBookingAction(await bookingActionDeps(), input));
}

export async function deleteBooking(tripId: string, bookingId: string): Promise<BookingActionResult> {
  return refresh(tripId, await deleteBookingAction(await bookingActionDeps(), tripId, bookingId));
}
