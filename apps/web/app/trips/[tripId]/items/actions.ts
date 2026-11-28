"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { loadDayDraft } from "../../../../lib/server/day-draft";
import { itemEditDeps } from "../../../../lib/server/item-edit";
import { parseBatchForm, parseEditForm, submitBatch, submitEdit, type EditResult } from "../../../../lib/server/item-edit-core";

// 決策 0010 E、決策 0011：新增、修改、刪除、排序、移動、複製、整天交換與編輯模式的批次。
// Next.js 比對 Origin 與 Host；登入與速率限制在 item-edit-core 內檢查（C-11）

export async function editItem(_previous: EditResult | null, form: FormData): Promise<EditResult> {
  const tripId = form.get("tripId");
  if (typeof tripId !== "string") return { ok: false, message: "行程不正確" };
  let current;
  const kind = form.get("kind");
  if (kind === "update" || kind === "duplicate") {
    const view = await loadDayDraft(tripId);
    const item = view.state === "ok" ? view.items[String(form.get("itemId"))] : undefined;
    if (!item) return { ok: false, message: "找不到這個項目" };
    current = { name_zh: item.nameZh, type: item.type, address: item.address, suggested_stay_minutes: item.stayMinutes, note: item.note, place_id: item.placeId };
  }
  const parsed = parseEditForm(form, current);
  if (!parsed.ok) return parsed;
  const result = await submitEdit(await itemEditDeps(), tripId, parsed.request);
  if (result.ok) revalidatePath(`/trips/${tripId}`, "layout");
  // 刪除後項目已不存在，回到行程
  if (result.ok && result.mode !== "proposal" && parsed.request.kind === "delete") redirect(`/trips/${tripId}/days`);
  if (result.ok && result.mode !== "proposal" && parsed.request.kind === "duplicate" && result.itemId) redirect(`/trips/${tripId}/items/${result.itemId}/edit`);
  return result;
}

// 編輯模式「完成」：一天的順序、時間、刪除與插入一次送出
export async function saveDayBatch(_previous: EditResult | null, form: FormData): Promise<EditResult> {
  const tripId = form.get("tripId");
  if (typeof tripId !== "string") return { ok: false, message: "行程不正確" };
  const parsed = parseBatchForm(form);
  if (!parsed.ok) return parsed;
  const result = await submitBatch(await itemEditDeps(), tripId, parsed.batch);
  if (result.ok) revalidatePath(`/trips/${tripId}`, "layout");
  return result;
}
