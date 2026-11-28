"use server";

import { revalidatePath } from "next/cache";
import { confirmImport, type ImportConfirmResult } from "../../../../lib/server/import-confirm-core";
import { importConfirmDeps } from "../../../../lib/server/import-confirm";

// 決策 0010 I：匯入的確認。以本人 session 經預訂與行程編輯的寫入路徑寫入（登入與速率限制在 import-confirm-core 內檢查，C-11）

export async function confirmImportRows(input: unknown): Promise<ImportConfirmResult> {
  const result = await confirmImport(await importConfirmDeps(), input);
  const tripId = input && typeof input === "object" ? (input as { tripId?: unknown }).tripId : undefined;
  if (typeof tripId === "string" && /^[0-9a-f-]{36}$/.test(tripId)) {
    revalidatePath(`/trips/${tripId}/bookings`, "layout");
    revalidatePath(`/trips/${tripId}/days`);
    revalidatePath(`/trips/${tripId}/today`);
    revalidatePath(`/trips/${tripId}/proposals`);
    revalidatePath(`/trips/${tripId}/candidates`);
  }
  return result;
}
