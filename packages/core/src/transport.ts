import type { Row, TripBaselineData } from "@atps/schemas";

// T28：交通動線比較（D27、決策 0008）。
// 不接路線 API：Transport AI 依官方資料估算各交通方式；伺服器加上固定緩衝（每段 10 分鐘，每次轉乘再加 5 分鐘），
// 比較出推薦、最快、最便宜、最舒適或低風險四種方案。所有時間都是估算。

type Segment = Row<"mobility_segments">;
export type StoredMobilityEstimate = Segment["estimates"][number];
export type SegmentPlans = NonNullable<Segment["plans"]>;
export type TransportMode = StoredMobilityEstimate["mode"];
export type AiMobilityEstimate = Omit<StoredMobilityEstimate, "source_urls" | "buffer_minutes" | "total_minutes"> & {
  sources: { url: string; fetched_at: string; grade: "facility_official" | "official_transport_tourism" | "reliable_third_party" | "user_reviews" }[];
};

export const FIXED_BUFFER_MINUTES = 10;
export const BUFFER_PER_TRANSFER_MINUTES = 5;

export const segmentBuffer = (transfers: number): number => FIXED_BUFFER_MINUTES + BUFFER_PER_TRANSFER_MINUTES * transfers;

export function withBuffer(estimate: AiMobilityEstimate): StoredMobilityEstimate {
  const { sources, ...rest } = estimate;
  const buffer = segmentBuffer(estimate.transfers);
  return {
    ...rest,
    source_urls: [...new Set(sources.map((s) => s.url))].slice(0, 5),
    buffer_minutes: buffer,
    total_minutes: estimate.door_to_door_minutes + buffer,
  };
}

const LEVEL: Record<"low" | "medium" | "high", number> = { low: 0, medium: 1, high: 2 };

// 步行沒有費用；其他方式費用不明時不列為最便宜
function priceOf(e: StoredMobilityEstimate): number | null {
  if (e.price) return e.price.amount;
  return e.mode === "walk" ? 0 : null;
}

function pick(estimates: readonly StoredMobilityEstimate[], score: (e: StoredMobilityEstimate) => number | null): StoredMobilityEstimate {
  const ranked = estimates
    .map((e) => ({ e, s: score(e) }))
    .filter((x): x is { e: StoredMobilityEstimate; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s || a.e.total_minutes - b.e.total_minutes || a.e.mode.localeCompare(b.e.mode));
  const first = ranked[0]?.e ?? estimates[0];
  if (!first) throw new Error("沒有交通估算");
  return first;
}

// 推薦：含緩衝的總時間、費用（每 100 日圓算 1 分鐘）、步行（每分鐘算 0.5 分鐘）、延誤風險（每級 5 分鐘），
// 符合基線交通偏好的方式減 15 分鐘
export const PREFERENCE_BONUS_MINUTES = 15;

export function comparePlans(
  estimates: readonly StoredMobilityEstimate[],
  preferences: TripBaselineData["transport_preferences"],
): SegmentPlans {
  const preferred = new Set(preferences);
  return {
    recommended: pick(estimates, (e) =>
      e.total_minutes +
      (priceOf(e) ?? 0) / 100 +
      e.walk_minutes * 0.5 +
      LEVEL[e.delay_risk] * 5 -
      (preferred.has(e.mode) ? PREFERENCE_BONUS_MINUTES : 0),
    ).mode,
    fastest: pick(estimates, (e) => e.total_minutes * 100 + e.transfers).mode,
    cheapest: pick(estimates, priceOf).mode,
    // 舒適度高、延誤風險低、行李便利者優先（分數越高越好，取負值排序）
    comfortable: pick(estimates, (e) => -(LEVEL[e.comfort] + (2 - LEVEL[e.delay_risk]) + LEVEL[e.luggage_friendliness])).mode,
  };
}

// 每個分區依由出發地前往的分鐘數排序，相鄰兩個候選為一段（T29 排定每日順序後改依實際順序估算）
export function segmentPairs(zones: readonly { items: readonly { item_id: string; minutes: number }[] }[]): { from: string; to: string }[] {
  return zones.flatMap((zone) => {
    const ordered = [...zone.items].sort((a, b) => a.minutes - b.minutes || a.item_id.localeCompare(b.item_id));
    return ordered.slice(1).map((item, i) => ({ from: ordered[i]?.item_id ?? "", to: item.item_id }));
  });
}
