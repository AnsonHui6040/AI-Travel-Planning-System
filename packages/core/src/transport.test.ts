import { describe, expect, it } from "vitest";
import { comparePlans, segmentBuffer, segmentPairs, withBuffer, type AiMobilityEstimate } from "./index";

// T28：交通動線比較（D27、決策 0008：每段固定緩衝 10 分鐘，每次轉乘再加 5 分鐘）

const src = (path: string) => ({ url: `https://railway.example.jp/${path}`, fetched_at: "2026-11-24T10:00:00+09:00", grade: "official_transport_tourism" as const });
const estimate = (over: Partial<AiMobilityEstimate>): AiMobilityEstimate => ({
  mode: "rail",
  door_to_door_minutes: 30,
  price: { amount: 200, currency: "JPY" },
  walk_minutes: 8,
  transfers: 1,
  luggage_friendliness: "medium",
  comfort: "medium",
  delay_risk: "medium",
  sources: [src("a")],
  ...over,
});

describe("segmentBuffer", () => {
  it("每段 10 分鐘，每次轉乘再加 5 分鐘", () => {
    expect(segmentBuffer(0)).toBe(10);
    expect(segmentBuffer(2)).toBe(20);
  });
});

describe("withBuffer", () => {
  it("每個估算加上緩衝、含緩衝的總時間與來源網址", () => {
    expect(withBuffer(estimate({ door_to_door_minutes: 25, transfers: 2, sources: [src("x"), src("y")] }))).toMatchObject({
      buffer_minutes: 20,
      total_minutes: 45,
      source_urls: ["https://railway.example.jp/x", "https://railway.example.jp/y"],
    });
  });
});

describe("comparePlans", () => {
  const walk = estimate({ mode: "walk", door_to_door_minutes: 40, price: null, walk_minutes: 40, transfers: 0, comfort: "low", delay_risk: "low" });
  const rail = estimate({ mode: "rail", door_to_door_minutes: 18, transfers: 1, price: { amount: 180, currency: "JPY" } });
  const taxi = estimate({
    mode: "taxi",
    door_to_door_minutes: 15,
    transfers: 0,
    walk_minutes: 0,
    price: { amount: 2500, currency: "JPY" },
    comfort: "high",
    delay_risk: "low",
    luggage_friendliness: "high",
  });

  it("輸出推薦、最快、最便宜、最舒適或低風險四種方案", () => {
    const plans = comparePlans([walk, rail, taxi].map(withBuffer), []);
    expect(Object.keys(plans).sort()).toEqual(["cheapest", "comfortable", "fastest", "recommended"]);
    // 最快以含緩衝的總時間比較：計程車 15+10=25，鐵路 18+15=33
    expect(plans.fastest).toBe("taxi");
    // 步行沒有費用
    expect(plans.cheapest).toBe("walk");
    expect(plans.comfortable).toBe("taxi");
    expect(plans.recommended).toBe("rail");
  });

  it("只有一個估算時四種方案都是同一個方式", () => {
    expect(comparePlans([withBuffer(rail)], [])).toEqual({ recommended: "rail", fastest: "rail", cheapest: "rail", comfortable: "rail" });
  });

  it("交通偏好會影響推薦", () => {
    expect(comparePlans([walk, rail, taxi].map(withBuffer), ["taxi"]).recommended).toBe("taxi");
  });

  it("費用不明（非步行）時不列為最便宜", () => {
    const bus = estimate({ mode: "bus", price: null, door_to_door_minutes: 50, transfers: 0 });
    expect(comparePlans([bus, rail].map(withBuffer), []).cheapest).toBe("rail");
  });
});

describe("segmentPairs", () => {
  it("每個分區依由出發地前往的分鐘數排序，相鄰兩個候選為一段", () => {
    const pairs = segmentPairs([
      { items: [{ item_id: "c", minutes: 30 }, { item_id: "a", minutes: 10 }, { item_id: "b", minutes: 20 }] },
      { items: [{ item_id: "x", minutes: 5 }] },
    ]);
    expect(pairs).toEqual([
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ]);
  });
});
