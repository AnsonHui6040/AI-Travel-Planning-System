import { z } from "zod";
import { LIMITS, hhmm, isoDate, text, uuid } from "./common";
import { itemType } from "./enums";

// S-01：AI 與成員只能提出符合此 schema 的變更。正式資料只由 applyChange 依此內容寫入。

// 第 2.6 節批准規則表的 12 種變更
export const CHANGE_KINDS = [
  "new_candidate",
  "candidate_verification_update",
  "fact_correction",
  "approved_fact_invalidated",
  "reschedule_after_invalidation",
  "incident_L1",
  "incident_L2",
  "incident_L3",
  "incident_L4",
  "major_version",
  "minor_non_incident",
  "add_candidate_to_gap",
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

// 第 2.7 節 Major 的結構變更
export const STRUCTURAL_CHANGES = ["hotel", "flight_date", "cancel_day"] as const;
export type StructuralChange = (typeof STRUCTURAL_CHANGES)[number];

const scheduleItem = z
  .strictObject({
    op: z.literal("schedule_item"),
    itemId: uuid,
    date: isoDate.nullable(),
    start: hhmm.nullable(),
    end: hhmm.nullable(),
  })
  .refine((o) => o.start === null || o.end === null || o.end >= o.start, "結束時間不可早於開始時間");

const setAtRisk = z.strictObject({
  op: z.literal("set_at_risk"),
  itemId: uuid,
  atRisk: z.boolean(),
});

// 決策 0010：成員自行新增或修改的項目欄位。place_id 只在搜尋加入時由伺服器帶入（D28：只保存 place_id）
export const userItemFields = z.strictObject({
  name_zh: text(LIMITS.nameZh),
  type: itemType,
  address: text(LIMITS.address).nullable(),
  suggested_stay_minutes: z.int().min(LIMITS.stayMinutes.min).max(LIMITS.stayMinutes.max),
  note: text(LIMITS.itemNote).nullable(),
  place_id: z.string().regex(/^[A-Za-z0-9_-]{10,300}$/, "place_id 格式不正確").nullable(),
});
export type UserItemFields = z.infer<typeof userItemFields>;

const slotRefine = (o: { date: string | null; start: string | null; end: string | null }) =>
  (o.date === null && o.start === null && o.end === null) || (o.date !== null && o.start !== null && o.end !== null && o.end > o.start);

// 決策 0010：行程鎖定後成員的編輯成為提案（新增、修改、刪除）。只有成員提出的提案可以含這三種操作
const addItem = z
  .strictObject({
    op: z.literal("add_item"),
    itemId: uuid,
    item: userItemFields,
    date: isoDate.nullable(),
    start: hhmm.nullable(),
    end: hhmm.nullable(),
  })
  .refine(slotRefine, "日期與時間須同時填寫，結束時間須晚於開始時間");

const updateItem = z
  .strictObject({
    op: z.literal("update_item"),
    itemId: uuid,
    fields: userItemFields.partial(),
  })
  .refine((o) => Object.keys(o.fields).length > 0, "沒有要修改的欄位");

const removeItem = z.strictObject({ op: z.literal("remove_item"), itemId: uuid });

export const MEMBER_ONLY_OPERATIONS = ["add_item", "update_item", "remove_item"] as const;

export const changeOperation = z.discriminatedUnion("op", [scheduleItem, setAtRisk, addItem, updateItem, removeItem]);
export type ChangeOperation = z.infer<typeof changeOperation>;

const payloadShape = {
  changeKind: z.enum(CHANGE_KINDS),
  versionKind: z.enum(["major", "minor"]),
  summary: text(500),
  reason: text(500).optional(),
  structural: z.array(z.enum(STRUCTURAL_CHANGES)).max(STRUCTURAL_CHANGES.length).optional(),
};

export const changePayload = z.strictObject({
  ...payloadShape,
  operations: z.array(changeOperation).min(1).max(50),
});
export type ChangePayload = z.infer<typeof changePayload>;

// S-01、D07：AI 的提案只能改排程與 At Risk；新增、修改、刪除項目只有成員可以提出
export const aiChangeOperation = z.discriminatedUnion("op", [scheduleItem, setAtRisk]);
export const aiChangePayload = z.strictObject({
  ...payloadShape,
  operations: z.array(aiChangeOperation).min(1).max(50),
});

// T10A：每個版本保存的完整行程快照（versions.snapshot）。只含排程，At Risk 屬事實資料不隨復原改動
export const scheduleSlot = z.strictObject({
  itemId: uuid,
  date: isoDate.nullable(),
  start: hhmm.nullable(),
  end: hhmm.nullable(),
});
export type ScheduleSlot = z.infer<typeof scheduleSlot>;

export const scheduleSnapshot = z.array(scheduleSlot).max(1000);
export type ScheduleSnapshot = z.infer<typeof scheduleSnapshot>;

// 資料庫函式 restore_version 的回傳格式
export const restoreResult = z.strictObject({
  outcome: z.literal("restored"),
  major: z.number().int().min(1),
  minor: z.number().int().min(0),
  version_id: uuid,
});

// 資料庫函式 approve_proposal、auto_apply_proposal 的回傳格式
export const commitResult = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("applied"),
    major: z.number().int().min(1),
    minor: z.number().int().min(0),
    invalidated_ids: z.array(uuid),
  }),
  z.strictObject({ outcome: z.literal("invalidated") }),
]);
