"use server";

import { revalidatePath } from "next/cache";
import { markAllReadAction, setReverifyAction, type InboxActionResult } from "../lib/server/inbox-core";
import { inboxActionDeps } from "../lib/server/inbox";

// T31：未讀通知標為已讀；Owner 開關旅前自動再核實。登入與速率限制在 inbox-core 內檢查（C-11）

export async function markAllRead(_previous: InboxActionResult | null): Promise<InboxActionResult> {
  const result = await markAllReadAction(await inboxActionDeps());
  if (result.ok) revalidatePath("/");
  return result;
}

export async function setReverify(_previous: InboxActionResult | null, form: FormData): Promise<InboxActionResult> {
  const tripId = form.get("tripId");
  const result = await setReverifyAction(await inboxActionDeps(), tripId, form.get("value"));
  if (result.ok && typeof tripId === "string") revalidatePath(`/trips/${tripId}/days`);
  return result;
}
