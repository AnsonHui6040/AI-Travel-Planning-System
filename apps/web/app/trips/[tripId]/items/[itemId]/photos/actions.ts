"use server";

import { revalidatePath } from "next/cache";
import { uploadPhotoAction, type ActionResult } from "../../../../../../lib/server/photos-core";
import { photoActionDeps } from "../../../../../../lib/server/photos";

// Next.js 對 Server Action 比對 Origin 與 Host；登入與速率限制在 uploadPhotoAction 內檢查（C-11）
export async function submitPhoto(_previous: ActionResult | null, form: FormData): Promise<ActionResult> {
  const result = await uploadPhotoAction(await photoActionDeps(), form);
  const tripId = form.get("tripId");
  const itemId = form.get("itemId");
  if (result.ok && typeof tripId === "string" && typeof itemId === "string") revalidatePath(`/trips/${tripId}/items/${itemId}/photos`);
  return result;
}
