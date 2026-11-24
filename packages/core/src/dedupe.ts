import type { Row } from "@atps/schemas";

// T25：候選去重。判定為重複的條件（任一）：
// 1. place_id 相同
// 2. 兩筆都沒有不同的 place_id，名稱（中文或當地名稱，正規化後）相同，且地區相同或座標相距 300 公尺內
// 每組保留最早建立的一筆，其餘併入。

type Item = Row<"itinerary_items">;
type SourceRef = Item["sources"][number];

export interface DedupeItem {
  id: string;
  place_id: string | null;
  name_zh: string;
  name_local: string | null;
  area: string | null;
  coord_lat: number | null;
  coord_lng: number | null;
  created_at: string;
}

export interface DuplicateGroup {
  keep: string;
  drop: string[];
}

export const SAME_PLACE_METERS = 300;

export function normalizePlaceName(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function names(item: DedupeItem): Set<string> {
  return new Set([item.name_zh, item.name_local].filter((n): n is string => !!n).map(normalizePlaceName).filter((n) => n !== ""));
}

function distanceMeters(a: DedupeItem, b: DedupeItem): number | null {
  if (a.coord_lat === null || a.coord_lng === null || b.coord_lat === null || b.coord_lng === null) return null;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.coord_lat - a.coord_lat);
  const dLng = rad(b.coord_lng - a.coord_lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.coord_lat)) * Math.cos(rad(b.coord_lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

function isDuplicate(a: DedupeItem, b: DedupeItem): boolean {
  if (a.place_id && b.place_id) return a.place_id === b.place_id;
  const na = names(a);
  if (![...names(b)].some((n) => na.has(n))) return false;
  const distance = distanceMeters(a, b);
  if (distance !== null) return distance <= SAME_PLACE_METERS;
  return a.area !== null && b.area !== null && normalizePlaceName(a.area) === normalizePlaceName(b.area);
}

export function findDuplicateGroups(items: readonly DedupeItem[]): DuplicateGroup[] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root] ?? root;
    parent[i] = root;
    return root;
  };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a && b && isDuplicate(a, b)) parent[find(j)] = find(i);
    }
  }

  const groups = new Map<number, DedupeItem[]>();
  items.forEach((item, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), item]);
  });

  const byCreated = (a: DedupeItem, b: DedupeItem) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
  const result: DuplicateGroup[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const [keep, ...drop] = [...members].sort(byCreated);
    if (keep) result.push({ keep: keep.id, drop: drop.map((d) => d.id) });
  }
  return result.sort((a, b) => a.keep.localeCompare(b.keep));
}

// 證據順序：設施官方、官方交通或旅遊局、可靠第三方、使用者評論（第 2.5 節）
export const EVIDENCE_ORDER: readonly SourceRef["grade"][] = [
  "facility_official",
  "official_transport_tourism",
  "reliable_third_party",
  "user_reviews",
];
