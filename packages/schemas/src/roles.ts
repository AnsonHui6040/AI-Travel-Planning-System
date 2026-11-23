import { z } from "zod";
import { changePayload } from "./change";
import { LIMITS, isoDate, text, uuid } from "./common";
import { mobilityEstimate, sourceRef } from "./entities";
import * as E from "./enums";

const nullable = <T extends z.ZodType>(schema: T) => schema.nullable();
const int = (min: number, max: number) => z.int().min(min).max(max);

// T14：五個角色的輸出 schema（S-01、S-02）。一律 strictObject：拒絕未知欄位，例如圖片網址（S-16）。
// 送給 AI 時轉成 JSON Schema（packages/ai），回傳後以這裡的 schema 嚴格驗證。

const sources = z.array(sourceRef).min(1).max(10);

// T24 必填：名稱、地區、類型、推薦原因、停留時間、限制、來源、資料日期
export const researchCandidate = z.strictObject({
  name_zh: text(LIMITS.nameZh),
  name_local: nullable(text(LIMITS.nameLocal)),
  area: text(LIMITS.area),
  type: E.itemType,
  recommendation_reason: text(LIMITS.longText),
  suggested_stay_minutes: int(LIMITS.stayMinutes.min, LIMITS.stayMinutes.max),
  constraints: nullable(text(LIMITS.longText)),
  sources,
  data_date: isoDate,
});

export const verificationResult = z.strictObject({
  item_id: uuid,
  status: E.verificationStatus,
  findings: text(LIMITS.longText),
  sources,
});

export const transportSegment = z.strictObject({
  from_item_id: uuid,
  to_item_id: uuid,
  estimates: z.array(mobilityEstimate).min(1).max(5),
  sources,
});

export const roleOutputs = {
  research: z.strictObject({ candidates: z.array(researchCandidate).max(30) }),
  verification: z.strictObject({ results: z.array(verificationResult).max(50) }),
  transport: z.strictObject({ segments: z.array(transportSegment).max(30) }),
  master_planner: z.strictObject({ proposals: z.array(changePayload).min(1).max(5) }),
  live_planner: z.strictObject({ proposals: z.array(changePayload).min(1).max(3) }),
} as const;

export type RoleOutputs = { [K in keyof typeof roleOutputs]: z.infer<(typeof roleOutputs)[K]> };
