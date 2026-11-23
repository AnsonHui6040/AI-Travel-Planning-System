import { SensitiveFieldFormatError, type SupabaseSensitiveFields } from "@atps/db";
import { SENSITIVE_FIELDS, parseSensitiveValue, uuid, type SensitiveField } from "@atps/schemas";

// T17：「我的聯絡資料」Server Action 邏輯（D18、S-07、S-10）。
// 當事人由資料庫取自 session，表單不傳使用者編號；回應訊息與 log 不含值。

export interface SensitiveActionDeps {
  getUser: () => Promise<{ id: string } | null>;
  checkRateLimit: (endpoint: string, limit: number, windowSeconds: number) => Promise<boolean>;
  fields: Pick<SupabaseSensitiveFields, "save" | "setSharing">;
  // 寫出前遮罩 values（S-10）
  logError: (message: string, values: readonly string[]) => void;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

export const FIELD_LABELS: Record<SensitiveField, string> = { full_name: "全名", phone: "電話", email: "電子郵件" };

const RATE = { endpoint: "sensitive_fields.write", limit: 20, windowSeconds: 60 } as const;

export async function sensitiveFieldAction(deps: SensitiveActionDeps, form: FormData): Promise<ActionResult> {
  const user = await deps.getUser();
  if (!user) return { ok: false, message: "需要登入" };
  if (!(await deps.checkRateLimit(RATE.endpoint, RATE.limit, RATE.windowSeconds))) {
    return { ok: false, message: "操作過於頻繁，請稍後再試" };
  }

  const tripId = form.get("tripId");
  if (typeof tripId !== "string" || !uuid.safeParse(tripId).success) return { ok: false, message: "行程不正確" };
  const fieldRaw = form.get("field");
  if (typeof fieldRaw !== "string" || !(SENSITIVE_FIELDS as readonly string[]).includes(fieldRaw)) {
    return { ok: false, message: "不支援的欄位" };
  }
  const field = fieldRaw as SensitiveField;
  const label = FIELD_LABELS[field];
  const raw = form.get("value");
  const text = typeof raw === "string" ? raw.trim() : "";

  let value = "";
  if (text !== "") {
    const parsed = parseSensitiveValue(field, text);
    if (!parsed.ok) return { ok: false, message: parsed.error };
    value = parsed.value;
  }

  try {
    await deps.fields.save(tripId, field, value);
    if (value === "") return { ok: true, message: `已刪除${label}` };
    await deps.fields.setSharing(tripId, field, {
      ai: form.get("share_ai") === "on",
      members: form.get("share_members") === "on",
      viewers: form.get("share_viewers") === "on",
    });
    return { ok: true, message: `已儲存${label}` };
  } catch (error) {
    if (error instanceof SensitiveFieldFormatError) return { ok: false, message: `${label}格式不正確` };
    deps.logError("儲存敏感欄位失敗", [text]);
    return { ok: false, message: "儲存失敗，請確認你是此行程的成員" };
  }
}
