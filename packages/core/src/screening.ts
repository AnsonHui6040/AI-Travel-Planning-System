import type { Row, TripBaselineData } from "@atps/schemas";
import { normalizePlaceName } from "./dedupe";
import type { ResearchTrackId } from "./research";

// T26：候選篩選（決策 0007）。八個維度各 0–5 分，5 = 最適合排入行程；
// 依旅行基線、地區、類型、停留時間與已知事實以確定性規則計算，不呼叫 AI。
// 每個地區與類型的組合中總分最高的 2 個為 Primary，其餘為 Backup；必去地點一律 Primary，排除地點一律 Backup。

type Item = Row<"itinerary_items">;

export const SCREENING_DIMENSIONS = [
  "personal_value",
  "uniqueness",
  "geographic_fit",
  "time_cost",
  "transport_cost",
  "weather_dependency",
  "time_slot_dependency",
  "substitutability",
] as const;
export type ScreeningDimension = (typeof SCREENING_DIMENSIONS)[number];

export const SCREENING_LABELS: Record<ScreeningDimension, string> = {
  personal_value: "個人價值",
  uniqueness: "獨特性",
  geographic_fit: "地理配合",
  time_cost: "時間成本",
  transport_cost: "交通成本",
  weather_dependency: "天氣依賴",
  time_slot_dependency: "時段依賴",
  substitutability: "替代性",
};

export const PRIMARY_PER_GROUP = 2;

export interface ScreeningItem {
  id: string;
  name_zh: string;
  name_local: string | null;
  area: string | null;
  type: Item["type"];
  suggested_stay_minutes: number;
  research_track: ResearchTrackId | null;
  fact_claims: Item["fact_claims"];
}

export interface ScreeningResult {
  item_id: string;
  scores: Record<ScreeningDimension, number>;
  total: number;
  candidate_role: Item["candidate_role"];
  priority: number;
  weather_dependency: Item["weather_dependency"];
}

const norm = (s: string | null) => (s ? normalizePlaceName(s) : "");

function matchesAny(item: ScreeningItem, names: readonly string[]): boolean {
  const wanted = new Set(names.map(norm).filter((n) => n !== ""));
  return [item.name_zh, item.name_local].some((n) => n !== null && wanted.has(norm(n)));
}

function timeCost(minutes: number): number {
  if (minutes <= 60) return 5;
  if (minutes <= 120) return 4;
  if (minutes <= 180) return 3;
  if (minutes <= 240) return 2;
  return 1;
}

const WEATHER: Record<Item["type"], { score: number; level: Item["weather_dependency"] }> = {
  photography: { score: 1, level: "high" },
  attraction: { score: 3, level: "medium" },
  activity: { score: 3, level: "medium" },
  restaurant: { score: 5, level: "low" },
  shopping: { score: 5, level: "low" },
};

export function screenCandidates(items: readonly ScreeningItem[], context: { baseline: TripBaselineData }): ScreeningResult[] {
  const b = context.baseline;
  const anchorAreas = new Set(
    [...b.lodgings.map((l) => l.area), ...b.fixed_activities.map((a) => a.area)].map(norm).filter((a) => a !== ""),
  );
  const groupKey = (i: ScreeningItem) => `${norm(i.area)}|${i.type}`;
  const groupSize = new Map<string, number>();
  const areaSize = new Map<string, number>();
  for (const i of items) {
    groupSize.set(groupKey(i), (groupSize.get(groupKey(i)) ?? 0) + 1);
    if (i.area) areaSize.set(norm(i.area), (areaSize.get(norm(i.area)) ?? 0) + 1);
  }

  const scored = items.map((i) => {
    const mustVisit = matchesAny(i, b.must_visit);
    const excluded = matchesAny(i, b.excluded);
    const area = norm(i.area);
    const sameGroupOthers = (groupSize.get(groupKey(i)) ?? 1) - 1;
    const atAnchor = area !== "" && anchorAreas.has(area);

    let personal = 3;
    if (i.type === "photography" && b.photography_needs) personal = 4;
    if (mustVisit) personal = 5;
    if (excluded) personal = 0;

    let uniqueness = 3;
    if (i.research_track === "D") uniqueness = 4;
    if (sameGroupOthers >= 2) uniqueness = Math.min(uniqueness, 2);

    let geographic = 2;
    if (area === "") geographic = 1;
    else if (atAnchor) geographic = 5;
    else if ((areaSize.get(area) ?? 1) >= 3) geographic = 4;

    // 交通估算於 T28 取得前，以是否在住宿或固定活動的地區估計
    const transport = area === "" ? 2 : atAnchor ? 5 : 3;

    const fields = new Set(i.fact_claims.map((f) => f.field));
    let timeSlot = 4;
    if (fields.has("opening_hours") || fields.has("closed_days")) timeSlot = 3;
    if (fields.has("reservation") || i.type === "photography") timeSlot = 2;

    let substitutability = sameGroupOthers === 0 ? 5 : sameGroupOthers === 1 ? 3 : 1;
    if (mustVisit) substitutability = 5;

    const scores: Record<ScreeningDimension, number> = {
      personal_value: personal,
      uniqueness,
      geographic_fit: geographic,
      time_cost: timeCost(i.suggested_stay_minutes),
      transport_cost: transport,
      weather_dependency: WEATHER[i.type].score,
      time_slot_dependency: timeSlot,
      substitutability,
    };
    const total = SCREENING_DIMENSIONS.reduce((sum, d) => sum + scores[d], 0);
    return { item: i, scores, total, mustVisit, excluded };
  });

  // 每組依總分排序（同分依名稱與編號，結果不受輸入順序影響）
  const primary = new Set<string>();
  const groups = new Map<string, typeof scored>();
  for (const s of scored) groups.set(groupKey(s.item), [...(groups.get(groupKey(s.item)) ?? []), s]);
  for (const members of groups.values()) {
    const ranked = members
      .filter((m) => !m.excluded)
      .sort((x, y) => y.total - x.total || x.item.name_zh.localeCompare(y.item.name_zh) || x.item.id.localeCompare(y.item.id));
    for (const m of ranked.slice(0, PRIMARY_PER_GROUP)) primary.add(m.item.id);
    for (const m of ranked) if (m.mustVisit) primary.add(m.item.id);
  }

  return scored.map((s) => ({
    item_id: s.item.id,
    scores: s.scores,
    total: s.total,
    candidate_role: primary.has(s.item.id) ? "primary" : "backup",
    // 總分 0–40 對應優先度 1–5
    priority: Math.min(5, Math.max(1, Math.round(s.total / 8))),
    weather_dependency: WEATHER[s.item.type].level,
  }));
}
