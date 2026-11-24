import { z } from "zod";
import { changePayload } from "./change";
import { LIMITS, isoDate, text, uuid } from "./common";
import { factClaim, mobilityEstimate, sourceRef } from "./entities";
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
  // T25：營業時間等事實，附來源；沒有時為空陣列
  facts: z.array(factClaim).max(10).default([]),
});

export const verificationResult = z.strictObject({
  item_id: uuid,
  status: E.verificationStatus,
  findings: text(LIMITS.longText),
  sources,
  // T25：核對後的事實，附來源；由伺服器依證據順序與 Research 的主張交叉判定
  facts: z.array(factClaim).max(10).default([]),
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

// T27：地理分區的輸出（以 Transport 的模型設定執行）。每個項目標示由出發地前往的轉乘次數與分鐘數（E9）
export const zoneAssignment = z.strictObject({
  item_id: uuid,
  transfers_from_base: int(0, 10),
  minutes_from_base: int(1, 1440),
});

export const zoningZone = z.strictObject({
  name: text(LIMITS.area),
  base_area: nullable(text(LIMITS.area)),
  rationale: text(LIMITS.longText),
  items: z.array(zoneAssignment).min(1).max(50),
  sources: z.array(sourceRef).max(10),
});

export const zoningOutput = z.strictObject({ zones: z.array(zoningZone).min(1).max(15) });
export type ZoningOutput = z.infer<typeof zoningOutput>;

export type RoleOutputs = { [K in keyof typeof roleOutputs]: z.infer<(typeof roleOutputs)[K]> };
