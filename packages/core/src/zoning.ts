import { zoningOutput, type Row, type TripBaselineData, type ZoningOutput } from "@atps/schemas";
import { leaks } from "./output-gate";
import { containsImageUrl, type ResearchInput } from "./research";

// T27：地理分區（D29）。AI 依自行搜尋的資料與交通估算把候選分群；
// prompt 不含任何 Google Maps 內容（place_id、座標及其推算結果），輸出以嚴格 schema 驗證。
// 分區後，每個主要區域（2 個以上候選）至少要有一個 Backup。

type Item = Row<"itinerary_items">;

export interface ZoningCandidate {
  id: string;
  name_zh: string;
  name_local: string | null;
  area: string | null;
  type: Item["type"];
  suggested_stay_minutes: number;
  candidate_role: Item["candidate_role"];
  // 以下欄位不會送給 AI（D29）
  place_id: string | null;
  coord_lat: number | null;
  coord_lng: number | null;
}

export const MAIN_ZONE_MIN_ITEMS = 2;

export function zoningInput(context: {
  trip: { name: string; destination: string | null };
  baseline: TripBaselineData;
  candidates: readonly ZoningCandidate[];
}): ResearchInput {
  const b = context.baseline;
  const data = {
    行程: context.trip.name,
    目的地: context.trip.destination,
    出發地: b.lodgings.map((l) => ({ 住宿: l.name, 地區: l.area, 入住: l.check_in, 退房: l.check_out })),
    固定活動: b.fixed_activities.map((a) => ({ 名稱: a.name, 地區: a.area, 日期: a.date })),
    交通偏好: b.transport_preferences,
    // 逐一列出允許的欄位：place_id 與座標不會帶入
    候選: context.candidates.map((c) => ({
      item_id: c.id,
      名稱: c.name_zh,
      當地名稱: c.name_local,
      地區: c.area,
      類型: c.type,
      停留分鐘: c.suggested_stay_minutes,
    })),
  };
  return {
    task: "地理分區：依你自行搜尋的交通資料，把候選分成可在同一段時間內順路遊覽的區域。分區依實際交通（直達、轉乘次數、門到門時間）而不是直線距離；每個候選標示由出發地前往的轉乘次數與分鐘數，含出發地的分區填寫出發地區，並附來源。",
    blocks: [{ kind: "trip", content: JSON.stringify(data, null, 2) }],
  };
}

export type ZoningRejection = "schema" | "image_url" | "leak" | "unknown_item" | "duplicate_item";

export type ZoningGateResult = { ok: true; output: ZoningOutput } | { ok: false; reason: ZoningRejection; detail: string };

export function gateZoningOutput(
  output: unknown,
  ctx: { knownItemIds: ReadonlySet<string>; forbiddenValues: readonly string[] },
): ZoningGateResult {
  const parsed = zoningOutput.safeParse(output);
  if (!parsed.success) return { ok: false, reason: "schema", detail: "分區輸出不符格式" };
  if (containsImageUrl(parsed.data)) return { ok: false, reason: "image_url", detail: "輸出含有圖片網址" };
  if (leaks(parsed.data, ctx.forbiddenValues)) return { ok: false, reason: "leak", detail: "輸出含有不可提供的資料" };
  const seen = new Set<string>();
  for (const zone of parsed.data.zones) {
    for (const item of zone.items) {
      if (!ctx.knownItemIds.has(item.item_id)) return { ok: false, reason: "unknown_item", detail: "分區指向不存在的項目" };
      if (seen.has(item.item_id)) return { ok: false, reason: "duplicate_item", detail: "同一個項目出現在兩個分區" };
      seen.add(item.item_id);
    }
  }
  return { ok: true, output: parsed.data };
}

export interface BackupCandidate {
  id: string;
  candidate_role: Item["candidate_role"];
  total: number;
  // 必去地點：不改為 Backup
  protected: boolean;
}

export function ensureZoneBackups(
  zones: readonly { items: readonly string[] }[],
  candidates: readonly BackupCandidate[],
): { item_id: string; candidate_role: "backup" }[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const changes: { item_id: string; candidate_role: "backup" }[] = [];
  for (const zone of zones) {
    const members = zone.items.map((id) => byId.get(id)).filter((c): c is BackupCandidate => c !== undefined);
    if (members.length < MAIN_ZONE_MIN_ITEMS || members.some((m) => m.candidate_role === "backup")) continue;
    const demote = members
      .filter((m) => !m.protected)
      .sort((a, b) => a.total - b.total || a.id.localeCompare(b.id))[0];
    if (demote) changes.push({ item_id: demote.id, candidate_role: "backup" });
  }
  return changes;
}
