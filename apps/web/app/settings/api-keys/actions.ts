"use server";

import { revalidatePath } from "next/cache";
import { apiKeyFormAction, type ActionResult } from "../../../lib/server/api-keys-core";
import { apiKeyDeps } from "../../../lib/server/api-keys";

// Next.js 對 Server Action 比對 Origin 與 Host；登入與速率限制在 apiKeyFormAction 內檢查（C-11）
export async function submitApiKey(_previous: ActionResult | null, form: FormData): Promise<ActionResult> {
  const result = await apiKeyFormAction(await apiKeyDeps(), form);
  if (result.ok) revalidatePath("/settings/api-keys");
  return result;
}
