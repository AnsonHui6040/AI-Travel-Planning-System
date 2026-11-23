import { z } from "zod";
import { offsetDateTime, uuid } from "./common";

// T17、D18：敏感欄位只限全名、電話、電子郵件；不收集護照與身分證字號。
// 格式與 migration 20261123160000_t17_sensitive_fields.sql 的 private.valid_sensitive_value 相同
export const SENSITIVE_FIELDS = ["full_name", "phone", "email"] as const;
export const sensitiveField = z.enum(SENSITIVE_FIELDS);
export type SensitiveField = z.infer<typeof sensitiveField>;

export const SENSITIVE_LIMITS = {
  fullName: 80,
  phoneChars: { min: 6, max: 25 },
  phoneDigits: { min: 6, max: 15 },
  email: 254,
  emailLocal: 64,
} as const;

const CONTROL = /\p{Cc}/u;
const PHONE = /^\+?[0-9 ()-]{6,25}$/;
const EMAIL = /^[^@\s]{1,64}@[^@\s.]+(\.[^@\s.]+)+$/;

const MESSAGES: Record<SensitiveField, string> = {
  full_name: `全名須為 1–${SENSITIVE_LIMITS.fullName} 字，不可含換行`,
  phone: "電話只可含數字、空白、括號、連字號與開頭的 +，數字 6–15 位",
  email: "電子郵件格式不正確",
};

// 錯誤訊息不含輸入值（S-10）
export function parseSensitiveValue(field: SensitiveField, raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim();
  const fail = { ok: false as const, error: MESSAGES[field] };
  if (value.length === 0 || CONTROL.test(value)) return fail;
  switch (field) {
    case "full_name":
      return [...value].length <= SENSITIVE_LIMITS.fullName ? { ok: true, value } : fail;
    case "phone": {
      const digits = value.replace(/[^0-9]/g, "").length;
      const okDigits = digits >= SENSITIVE_LIMITS.phoneDigits.min && digits <= SENSITIVE_LIMITS.phoneDigits.max;
      return PHONE.test(value) && okDigits ? { ok: true, value } : fail;
    }
    case "email":
      return value.length <= SENSITIVE_LIMITS.email && EMAIL.test(value) ? { ok: true, value } : fail;
  }
}

// 資料表只存 Vault secret 編號與三個開關，沒有明文欄位
export const memberSensitiveFieldRow = z.strictObject({
  trip_id: uuid,
  user_id: uuid,
  field: sensitiveField,
  vault_secret_id: uuid,
  share_ai: z.boolean(),
  share_members: z.boolean(),
  share_viewers: z.boolean(),
  updated_at: offsetDateTime,
});

// 資料庫函式 list_trip_sensitive_fields、ai_sensitive_fields 的回傳列
export const visibleSensitiveRow = z.object({
  user_id: uuid,
  field: sensitiveField,
  value: z.string(),
  share_ai: z.boolean().nullable(),
  share_members: z.boolean().nullable(),
  share_viewers: z.boolean().nullable(),
});
export const aiSensitiveRow = z.object({ user_id: uuid, field: sensitiveField, value: z.string() });
export const visibleSensitiveRows = z.array(visibleSensitiveRow);
export const aiSensitiveRows = z.array(aiSensitiveRow);
