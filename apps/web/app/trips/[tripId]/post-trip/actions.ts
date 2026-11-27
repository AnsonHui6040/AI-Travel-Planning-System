"use server";

import { revalidatePath } from "next/cache";
import { setPostTripStatusAction, type PostTripActionResult } from "../../../../lib/server/post-trip-core";
import { postTripDeps } from "../../../../lib/server/post-trip";

// T40：旅後狀態。Next.js 對 Server Action 比對 Origin 與 Host；登入與速率限制在 post-trip-core 內檢查（C-11）

export async function savePostTripStatus(_previous: PostTripActionResult | null, form: FormData): Promise<PostTripActionResult> {
  const fields = { tripId: form.get("tripId"), itemId: form.get("itemId"), status: form.get("status") };
  const result = await setPostTripStatusAction(await postTripDeps(), fields);
  if (result.ok && typeof fields.tripId === "string") revalidatePath(`/trips/${fields.tripId}`, "layout");
  return result;
}
