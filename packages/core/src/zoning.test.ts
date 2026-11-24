import type { TripBaselineData } from "@atps/schemas";
import { describe, expect, it } from "vitest";
import { ensureZoneBackups, gateZoningOutput, zoningInput, type ZoningCandidate } from "./index";

// T27：地理分區（D29）。AI 依自行搜尋的資料與交通估算分群；輸出經 schema 驗證

const A = "f4000000-0000-4000-8000-000000000001";
const B = "f4000000-0000-4000-8000-000000000002";
const C = "f4000000-0000-4000-8000-000000000003";

const baseline: TripBaselineData = {
  start_date: "2026-12-01",
  end_date: "2026-12-05",
  timezone: "Asia/Tokyo",
  flights: [],
  lodgings: [{ name: "新宿飯店", area: "新宿", check_in: "2026-12-01", check_out: "2026-12-05", check_in_time: null }],
  companions: 1,
  stamina_note: null,
  budget: null,
  fixed_activities: [],
  paid_items: [],
  must_visit: [],
  excluded: [],
  transport_preferences: ["rail"],
  photography_needs: null,
};

const candidate = (id: string, over: Partial<ZoningCandidate> = {}): ZoningCandidate => ({
  id,
  name_zh: "淺草寺",
  name_local: "浅草寺",
  area: "淺草",
  type: "attraction",
  suggested_stay_minutes: 60,
  candidate_role: "primary",
  place_id: "ChIJ_secret_place",
  coord_lat: 35.7148,
  coord_lng: 139.7967,
  ...over,
});

const src = { url: "https://www.jreast.co.jp/", fetched_at: "2026-11-24T10:00:00+09:00", grade: "official_transport_tourism" };
const zone = (name: string, items: Array<{ item_id: string; transfers_from_base: number; minutes_from_base: number }>, base_area: string | null = null) => ({
  name,
  base_area,
  rationale: "同一條路線可直達",
  items,
  sources: [src],
});

describe("zoningInput（D29）", () => {
  it("資料區塊含候選名稱、地區、類型與住宿地區，不含 place_id、座標等 Google Maps 內容", () => {
    const input = zoningInput({ trip: { name: "東京五日", destination: "東京" }, baseline, candidates: [candidate(A)] });
    const text = JSON.stringify(input);
    expect(input.blocks.map((b) => b.kind)).toEqual(["trip"]);
    expect(text).toContain(A);
    expect(text).toContain("淺草");
    expect(text).toContain("新宿");
    expect(text).not.toContain("ChIJ_secret_place");
    expect(text).not.toContain("35.7148");
    expect(text).not.toContain("139.7967");
    expect(input.task).toContain("轉乘");
  });
});

describe("gateZoningOutput", () => {
  const ctx = { knownItemIds: new Set([A, B, C]), forbiddenValues: ["test-only-key-0003"] };

  it("符合 schema 的分區通過", () => {
    const output = { zones: [zone("新宿與中央線", [{ item_id: A, transfers_from_base: 0, minutes_from_base: 20 }], "新宿")] };
    expect(gateZoningOutput(output, ctx)).toMatchObject({ ok: true });
  });

  it.each([
    ["未知欄位", { zones: [{ ...zone("x", [{ item_id: A, transfers_from_base: 0, minutes_from_base: 20 }]), color: "red" }] }, "schema"],
    ["缺轉乘次數", { zones: [zone("x", [{ item_id: A, minutes_from_base: 20 } as never])] }, "schema"],
    ["沒有分區", { zones: [] }, "schema"],
    ["指向未知項目", { zones: [zone("x", [{ item_id: "f4000000-0000-4000-8000-0000000000ff", transfers_from_base: 0, minutes_from_base: 5 }])] }, "unknown_item"],
    [
      "同一項目出現在兩個分區",
      { zones: [zone("x", [{ item_id: A, transfers_from_base: 0, minutes_from_base: 5 }]), zone("y", [{ item_id: A, transfers_from_base: 1, minutes_from_base: 9 }])] },
      "duplicate_item",
    ],
    ["含圖片網址", { zones: [{ ...zone("x", [{ item_id: A, transfers_from_base: 0, minutes_from_base: 5 }]), rationale: "見 https://x.example/map.png" }] }, "image_url"],
    ["含 API key", { zones: [{ ...zone("x", [{ item_id: A, transfers_from_base: 0, minutes_from_base: 5 }]), rationale: "test-only-key-0003" }] }, "leak"],
  ])("%s 時拒絕", (_title, output, reason) => {
    expect(gateZoningOutput(output, ctx)).toMatchObject({ ok: false, reason });
  });
});

describe("ensureZoneBackups", () => {
  it("主要區域（2 個以上候選）沒有 Backup 時，把總分最低的 Primary 改為 Backup", () => {
    const zones = [{ items: [A, B] }, { items: [C] }];
    const changes = ensureZoneBackups(zones, [
      { id: A, candidate_role: "primary", total: 30, protected: false },
      { id: B, candidate_role: "primary", total: 25, protected: false },
      { id: C, candidate_role: "primary", total: 20, protected: false },
    ]);
    expect(changes).toEqual([{ item_id: B, candidate_role: "backup" }]);
  });

  it("已有 Backup 的區域不變；必去地點不改為 Backup", () => {
    expect(
      ensureZoneBackups(
        [{ items: [A, B] }],
        [
          { id: A, candidate_role: "primary", total: 30, protected: false },
          { id: B, candidate_role: "backup", total: 25, protected: false },
        ],
      ),
    ).toEqual([]);
    expect(
      ensureZoneBackups(
        [{ items: [A, B, C] }],
        [
          { id: A, candidate_role: "primary", total: 10, protected: true },
          { id: B, candidate_role: "primary", total: 25, protected: false },
          { id: C, candidate_role: "primary", total: 30, protected: false },
        ],
      ),
    ).toEqual([{ item_id: B, candidate_role: "backup" }]);
  });
});
