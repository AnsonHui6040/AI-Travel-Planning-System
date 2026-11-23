import type { Row, SensitiveField } from "@atps/schemas";

// T17、S-07：送往 AI 的 payload 由 allowlist builder 產生；只帶出明列的欄位。
// S-17：不含 Google Maps 內容（place_id、地址、座標、當地名稱），行程項目以內部編號識別；使用者編號以成員代號取代。

export const AI_TRIP_FIELDS = ["id", "name", "destination", "start_date", "end_date", "timezone", "status", "current_version"] as const;

export const AI_ITEM_FIELDS = [
  "id",
  "name_zh",
  "type",
  "area",
  "suggested_stay_minutes",
  "availability",
  "reservation_requirement",
  "reservation_note",
  "constraint_class",
  "is_fixed",
  "priority",
  "weather_dependency",
  "candidate_role",
  "recommendation_reason",
  "constraint_note",
  "score_personal_value",
  "score_uniqueness",
  "score_geographic_fit",
  "score_time_cost",
  "score_transport_cost",
  "score_weather_dependency",
  "score_time_slot_dependency",
  "score_substitutability",
  "scheduled_date",
  "scheduled_start",
  "scheduled_end",
  "movable_from",
  "movable_to",
  "verification_status",
  "last_verified_at",
  "lifecycle_status",
  "at_risk",
  "standby",
  "post_trip_status",
  "estimated_cost_amount",
  "estimated_cost_currency",
  "actual_cost_amount",
  "actual_cost_currency",
  // 由 payer_id 轉成成員代號
  "payer",
] as const;

type TripRow = Row<"trips">;
type ItemRow = Row<"itinerary_items">;

export interface PayloadMember {
  userId: string;
  role: "owner" | "companion" | "viewer";
  displayName: string | null;
}

// 由 ai_sensitive_fields 取得；builder 仍再次檢查 shareAi
export interface SensitiveEntry {
  userId: string;
  field: SensitiveField;
  value: string;
  shareAi: boolean;
}

export interface AiPayloadInput {
  trip: TripRow;
  members: readonly PayloadMember[];
  sensitive: readonly SensitiveEntry[];
  items: readonly ItemRow[];
}

type AiTrip = Pick<TripRow, (typeof AI_TRIP_FIELDS)[number]>;
type AiItem = Partial<Pick<ItemRow, Exclude<(typeof AI_ITEM_FIELDS)[number], "payer">>> & { payer?: string | null };
export type AiMember = { ref: string; role: PayloadMember["role"]; displayName: string | null } & Partial<Record<SensitiveField, string>>;

export interface AiPayload {
  trip: AiTrip;
  members: AiMember[];
  items: AiItem[];
}

function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) if (Object.hasOwn(source, key)) out[key] = source[key];
  return out;
}

export function buildAiPayload(input: AiPayloadInput): AiPayload {
  const refs = new Map(input.members.map((m, i) => [m.userId, `M${i + 1}`]));

  const members: AiMember[] = input.members.map((m) => {
    const member: AiMember = { ref: refs.get(m.userId) as string, role: m.role, displayName: m.displayName };
    for (const entry of input.sensitive) {
      if (entry.userId === m.userId && entry.shareAi === true) member[entry.field] = entry.value;
    }
    return member;
  });

  const itemKeys = AI_ITEM_FIELDS.filter((k): k is Exclude<(typeof AI_ITEM_FIELDS)[number], "payer"> => k !== "payer");
  const items: AiItem[] = input.items.map((item) => {
    const out: AiItem = pick(item, itemKeys);
    if (Object.hasOwn(item, "payer_id")) out.payer = item.payer_id === null ? null : (refs.get(item.payer_id) ?? null);
    return out;
  });

  return { trip: pick(input.trip, AI_TRIP_FIELDS), members, items };
}

// 送給 provider 的 input 文字
export function serializeAiPayload(payload: AiPayload): string {
  return JSON.stringify(payload);
}
