import {
  PROVIDER_NAMES,
  gateImportOutput,
  importPreviewRows,
  runRole,
  type ImportPreview,
  type RoleRunDeps,
  type RoleSetting,
  type RoleSpec,
} from "@atps/core";
import { uuid } from "@atps/schemas";
import { buildImportPayload, composeRoleInput, type ImportPayload } from "@atps/security";
import { z } from "zod";

// 決策 0010 I：行程匯入的 Server Action 邏輯。
// 預覽：貼上的文字先以 buildImportPayload 移除全名、電話、電子郵件（S-07），放在資料區塊（S-03），
// 以使用者本人的 Master Planner 設定與 Vault key 執行（C-05）；輸出經 gateImportOutput 檢查，只回傳給本人的預覽（S-01：AI 不寫入）。
// 預覽不保存、不寫入 log（預約碼只出現在本人的畫面）。
// 確認（寫入）在 import-confirm-core.ts，與 AI 的模組分開（tooling/booking-ai-boundary.test.ts）。

export interface ImportContext {
  tripId: string;
  userId: string;
  timezone: string;
  dates: string[];
  canEdit: boolean;
  setting: RoleSetting;
  // 本人看得到的成員全名、電話、電子郵件（送 AI 前移除）
  knownValues: string[];
  // API key 與上面的值：輸出含有時拒絕
  forbiddenValues: string[];
}

export interface ImportPreviewDeps extends RoleRunDeps {
  getUser: () => Promise<{ id: string } | null>;
  checkRateLimit: (endpoint: string, limit: number, windowSeconds: number) => Promise<boolean>;
  load: (tripId: string) => Promise<ImportContext | null>;
  logError: (message: string) => void;
}

export type ImportPreviewResult =
  | { state: "ok"; preview: ImportPreview; removed: ImportPayload["removed"]; truncated: boolean }
  | { state: "empty"; message: string }
  | { state: "no_key"; message: string }
  | { state: "error"; message: string };

// 與其他 AI 操作相同：每位使用者每個端點的速率限制（C-11）
const PREVIEW_RATE = { endpoint: "import.preview", limit: 10, windowSeconds: 600 } as const;
export const IMPORT_INPUT_MAX = 50_000;

const TASK =
  "行程匯入：從資料區塊中貼上的文字整理出預訂（航班、住宿、餐廳、票券、交通、其他）與地點。預訂的時間以文字中寫的當地時間填寫，並填入該地的 IANA 時區；地點只有寫到日期與時間時才填。文字沒有寫到的欄位填 null，不要猜測。";
const UNREADABLE = "無法辨識貼上的內容，請確認是預訂確認信或行程的文字後再試一次。";
const error = (message: string): ImportPreviewResult => ({ state: "error", message });

const previewForm = z.object({ tripId: z.unknown(), text: z.unknown() });

export async function previewImport(deps: ImportPreviewDeps, spec: RoleSpec, raw: unknown): Promise<ImportPreviewResult> {
  const user = await deps.getUser();
  if (!user) return error("需要登入");
  if (!(await deps.checkRateLimit(PREVIEW_RATE.endpoint, PREVIEW_RATE.limit, PREVIEW_RATE.windowSeconds))) return error("操作過於頻繁，請稍後再試");
  const form = previewForm.safeParse(raw);
  const tripId = uuid.safeParse(form.success ? form.data.tripId : undefined);
  if (!tripId.success) return error("行程不正確");
  const text = form.success && typeof form.data.text === "string" ? form.data.text : "";
  if (text.trim() === "") return error("請貼上要匯入的文字");
  if ([...text].length > IMPORT_INPUT_MAX) return error(`文字太長，請分段貼上（最多 ${IMPORT_INPUT_MAX} 字）`);

  const ctx = await deps.load(tripId.data);
  if (!ctx) return error("找不到這個行程");
  if (!ctx.canEdit) return error("只有 Owner 與 Companion 可以匯入");

  const payload = buildImportPayload(text, { knownValues: ctx.knownValues });
  const result = await runRole(deps, {
    role: spec,
    setting: ctx.setting,
    input: composeRoleInput(TASK, [{ kind: "pasted_text", content: payload.text }]),
    ownerId: user.id,
    jobId: null,
  });

  switch (result.status) {
    case "not_configured":
      return { state: "no_key", message: `${result.reason}。請到「更多 → API key」輸入，或在「AI 設定」為 Master Planner 選擇其他 AI。` };
    case "provider_failed":
      return error(`${PROVIDER_NAMES[result.failedProvider]} 暫時無法使用，請稍後再試，或在「AI 設定」把 Master Planner 改用其他 AI。`);
    case "limit_reached":
      return error("內容太多，超過 AI 的用量上限，請分段貼上。");
    case "output_invalid":
      return error(UNREADABLE);
    case "completed":
      break;
  }

  const gated = gateImportOutput(result.output, { forbiddenValues: ctx.forbiddenValues });
  if (!gated.ok) {
    // 只記錄被拒的種類，不含輸出內容（S-10）
    deps.logError(`匯入輸出被拒絕（${gated.reason}）`);
    return error(UNREADABLE);
  }
  if (gated.output.bookings.length === 0 && gated.output.places.length === 0) {
    return { state: "empty", message: "沒有辨識到預訂或地點。請貼上確認信、行程或地點清單的文字。" };
  }
  return { state: "ok", preview: importPreviewRows(gated.output, ctx), removed: payload.removed, truncated: payload.truncated };
}
