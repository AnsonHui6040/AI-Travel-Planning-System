"use server";

import { revalidatePath } from "next/cache";
import { startResearchAction, type ResearchStartResult } from "../../../../lib/server/research-core";
import { researchStartDeps } from "../../../../lib/server/research";

// Next.js 對 Server Action 比對 Origin 與 Host；登入、速率限制與權限在 research-core 內檢查（C-11）

export async function startResearch(_previous: ResearchStartResult | null, form: FormData): Promise<ResearchStartResult> {
  const tripId = form.get("tripId");
  const result = await startResearchAction(await researchStartDeps(), tripId);
  if (result.ok && typeof tripId === "string") revalidatePath(`/trips/${tripId}`, "layout");
  // 回應不含 job 以外的資料
  return { ok: result.ok, message: result.message };
}
