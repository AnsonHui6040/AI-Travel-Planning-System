import { z } from "zod";
import { offsetDateTime, uuid } from "./common";

// 決策 0011：兩站之間的交通（成員輸入）。鍵名與 migration 20261128400000_f_full_editing.sql 的欄位一致。
// 只存項目編號、交通方式與門到門分鐘，不存 Google 內容（D28）

export const travelLegMode = z.enum(["walk", "train", "bus", "taxi", "car"]);
export type TravelLegMode = z.infer<typeof travelLegMode>;

export const travelLegRow = z.strictObject({
  trip_id: uuid,
  from_item_id: uuid,
  to_item_id: uuid,
  mode: travelLegMode,
  minutes: z.int().min(0).max(600),
  updated_by: uuid.nullable(),
  updated_at: offsetDateTime,
});
