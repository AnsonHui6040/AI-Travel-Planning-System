import { z } from "zod";
import { hhmm, isoDate, text, uuid } from "./common";

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

export const changeOperation = z.discriminatedUnion("op", [scheduleItem, setAtRisk]);
export type ChangeOperation = z.infer<typeof changeOperation>;

export const changePayload = z.strictObject({
  changeKind: z.enum(CHANGE_KINDS),
  versionKind: z.enum(["major", "minor"]),
  summary: text(500),
  reason: text(500).optional(),
  structural: z.array(z.enum(STRUCTURAL_CHANGES)).max(STRUCTURAL_CHANGES.length).optional(),
  operations: z.array(changeOperation).min(1).max(50),
});
export type ChangePayload = z.infer<typeof changePayload>;

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
