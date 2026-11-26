"use server";

import { revalidatePath } from "next/cache";
import { produceTimelineAction, recordEntryAction, type TimelineActionResult } from "../../../../lib/server/timeline-core";
import { timelineDeps } from "../../../../lib/server/timeline";

// T39：Actual Timeline。Next.js 對 Server Action 比對 Origin 與 Host；登入與速率限制在 timeline-core 內檢查（C-11）

const FIELDS = ["tripId", "date", "itemId", "completion", "arrived", "departed"] as const;

export async function recordEntry(_previous: TimelineActionResult | null, form: FormData): Promise<TimelineActionResult> {
  const fields = Object.fromEntries(FIELDS.map((k) => [k, form.get(k) ?? ""]));
  const result = await recordEntryAction(await timelineDeps(), fields);
  if (result.ok && typeof fields.tripId === "string") revalidatePath(`/trips/${fields.tripId}/timeline`);
  return result;
}

export async function produceTimeline(_previous: TimelineActionResult | null, form: FormData): Promise<TimelineActionResult> {
  const tripId = form.get("tripId");
  const result = await produceTimelineAction(await timelineDeps(), tripId, form.get("date"));
  if (result.ok && typeof tripId === "string") {
    revalidatePath(`/trips/${tripId}/timeline`);
    revalidatePath(`/trips/${tripId}/today`);
  }
  return result;
}
