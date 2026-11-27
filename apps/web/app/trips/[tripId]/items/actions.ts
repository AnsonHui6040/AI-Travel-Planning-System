"use server";

import { revalidatePath } from "next/cache";
import { loadDayDraft } from "../../../../lib/server/day-draft";
import { itemEditDeps } from "../../../../lib/server/item-edit";
import { parseEditForm, submitEdit, type EditResult } from "../../../../lib/server/item-edit-core";

// 決策 0010 E：新增、修改、刪除、排序與移動。Next.js 比對 Origin 與 Host；登入與速率限制在 item-edit-core 內檢查（C-11）

export async function editItem(_previous: EditResult | null, form: FormData): Promise<EditResult> {
  const tripId = form.get("tripId");
  if (typeof tripId !== "string") return { ok: false, message: "行程不正確" };
  let current;
  if (form.get("kind") === "update") {
    const view = await loadDayDraft(tripId);
    const item = view.state === "ok" ? view.items[String(form.get("itemId"))] : undefined;
    if (!item) return { ok: false, message: "找不到這個項目" };
    current = { name_zh: item.nameZh, type: item.type, address: item.address, suggested_stay_minutes: item.stayMinutes, note: item.note };
  }
  const parsed = parseEditForm(form, current);
  if (!parsed.ok) return parsed;
  const result = await submitEdit(await itemEditDeps(), tripId, parsed.request);
  if (result.ok) revalidatePath(`/trips/${tripId}`, "layout");
  return result;
}
