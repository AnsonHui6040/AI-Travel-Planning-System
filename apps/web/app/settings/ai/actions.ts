"use server";

import { revalidatePath } from "next/cache";
import { listModelsAction, saveRoleSettingAction, type ModelListResult } from "../../../lib/server/ai-settings-core";
import { aiSettingsDeps } from "../../../lib/server/ai-settings";

// Next.js 對 Server Action 比對 Origin 與 Host；登入與速率限制在各 action 內檢查（C-11）
export async function submitAiSettings(_previous: ModelListResult | null, form: FormData): Promise<ModelListResult> {
  const deps = await aiSettingsDeps();
  if (form.get("intent") === "models") return listModelsAction(deps, form);
  const result = await saveRoleSettingAction(deps, form);
  if (result.ok) revalidatePath("/settings/ai");
  return result;
}
