import "server-only";
import { bookingActionDeps } from "./bookings";
import { saveBookingAction } from "./bookings-core";
import type { ImportConfirmDeps } from "./import-confirm-core";
import { itemEditDeps } from "./item-edit";
import { parseEditForm, submitEdit } from "./item-edit-core";
import { supabaseGuardDeps } from "./supabase";

// 決策 0010 I：匯入確認的寫入連接。沿用預訂與行程編輯的寫入路徑（本人 session、RLS 限 Owner、Companion）；不呼叫 AI

export async function importConfirmDeps(): Promise<ImportConfirmDeps> {
  const guard = await supabaseGuardDeps();
  const [bookings, edits] = await Promise.all([bookingActionDeps(), itemEditDeps()]);
  return {
    getUser: guard.getUser,
    checkRateLimit: guard.checkRateLimit,
    saveBooking: (raw) => saveBookingAction(bookings, raw),
    async addPlace(tripId, form) {
      const parsed = parseEditForm(form);
      if (!parsed.ok) return parsed;
      return submitEdit(edits, tripId, parsed.request);
    },
  };
}
