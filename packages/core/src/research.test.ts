import type { TripBaselineData } from "@atps/schemas";
import { describe, expect, it } from "vitest";
import {
  RESEARCH_TRACKS,
  containsImageUrl,
  gateRoleOutput,
  researchTrackInput,
  toCandidateRows,
  type GateContext,
  type ResearchCandidate,
} from "./index";

// T24：多 AI 獨立研究（S-03、S-16）

const baseline: TripBaselineData = {
  start_date: "2026-12-01",
  end_date: "2026-12-05",
  timezone: "Asia/Tokyo",
  flights: [],
  lodgings: [{ name: "新宿飯店", area: "新宿", check_in: "2026-12-01", check_out: "2026-12-05", check_in_time: null }],
  companions: 1,
  stamina_note: "每天步行不超過 15000 步",
  budget: null,
  fixed_activities: [],
  paid_items: [],
  must_visit: ["淺草寺"],
  excluded: ["東京鐵塔"],
  transport_preferences: ["rail"],
  photography_needs: "想拍夜景",
};
const trip = { name: "東京五日", destination: "東京" };

const source = { url: "https://www.senso-ji.jp/", fetched_at: "2026-11-23T10:00:00+09:00", grade: "facility_official" as const };
const candidate: ResearchCandidate = {
  name_zh: "淺草寺",
  name_local: "浅草寺",
  area: "淺草",
  type: "attraction",
  recommendation_reason: "早上人少",
  suggested_stay_minutes: 60,
  constraints: null,
  sources: [source],
  data_date: "2026-11-23",
};

describe("RESEARCH_TRACKS", () => {
  it("四個研究方向 A–D，各有不同重點", () => {
    expect(RESEARCH_TRACKS.map((t) => t.id)).toEqual(["A", "B", "C", "D"]);
    expect(new Set(RESEARCH_TRACKS.map((t) => t.focus)).size).toBe(4);
    expect(RESEARCH_TRACKS.find((t) => t.id === "B")?.focus).toContain("餐飲");
  });
});

describe("researchTrackInput", () => {
  it("工作說明含該方向重點，資料區塊只有行程與基線", () => {
    const input = researchTrackInput("C", { trip, baseline });
    expect(input.task).toContain("攝影");
    expect(input.blocks.map((b) => b.kind)).toEqual(["trip"]);
    const content = input.blocks[0]?.content ?? "";
    expect(content).toContain("2026-12-01");
    expect(content).toContain("淺草寺");
    expect(content).toContain("想拍夜景");
  });

  it("job 輸入不含其他研究結果：即使傳入候選或其他方向的輸出也不會帶入", () => {
    const polluted = { trip, baseline, candidates: [{ name_zh: "A 方向的結論：築地場外市場" }], otherResults: "築地場外市場" };
    const input = researchTrackInput("B", polluted as Parameters<typeof researchTrackInput>[1]);
    expect(JSON.stringify(input)).not.toContain("築地場外市場");
  });

  it("四個方向的輸入除工作說明外完全相同（彼此不依賴）", () => {
    const blocks = RESEARCH_TRACKS.map((t) => JSON.stringify(researchTrackInput(t.id, { trip, baseline }).blocks));
    expect(new Set(blocks).size).toBe(1);
  });
});

describe("containsImageUrl（S-16）", () => {
  it.each([
    "https://example.com/photo.jpg",
    "https://example.com/a/b.PNG?size=2",
    "https://example.com/x.webp#frag",
    "https://lh3.googleusercontent.com/p/AF1Qip",
    "https://upload.wikimedia.org/wikipedia/commons/a/a1/X.svg",
    "https://places.googleapis.com/v1/places/abc/photos/def/media",
    "https://maps.googleapis.com/maps/api/place/photo?photoreference=x",
    "data:image/png;base64,AAAA",
    "參考 https://cdn.example.com/img/senso.jpeg 這張",
  ])("%s 視為圖片網址", (text) => {
    expect(containsImageUrl({ deep: [{ text }] })).toBe(true);
  });

  it.each(["https://www.senso-ji.jp/", "https://example.com/jpg-guide", "淺草寺的照片很好看.jpg 不是網址"])("%s 不是圖片網址", (text) => {
    expect(containsImageUrl({ text })).toBe(false);
  });

  const ctx: GateContext = { knownItemIds: new Set(), forbiddenValues: [] };

  it("來源網址是圖片時整個輸出被拒", () => {
    const output = { candidates: [{ ...candidate, sources: [{ ...source, url: "https://example.com/senso.jpg" }] }] };
    expect(gateRoleOutput("research", output, ctx)).toMatchObject({ ok: false, reason: "image_url" });
  });

  it("推薦原因內含圖片網址時整個輸出被拒", () => {
    const output = { candidates: [{ ...candidate, recommendation_reason: "看這張 https://i.example.com/a.png" }] };
    expect(gateRoleOutput("research", output, ctx)).toMatchObject({ ok: false, reason: "image_url" });
  });
});

describe("toCandidateRows（S-16）", () => {
  const generatedBy = { provider: "anthropic" as const, model: "claude-opus-5-5" };

  it("place_id 由伺服器解析；成功時寫入 place_id，核實狀態仍為 Unverified（研究不等於核實）", async () => {
    const calls: Array<{ name: string; area: string }> = [];
    const rows = await toCandidateRows([candidate], "A", generatedBy, async (q) => {
      calls.push(q);
      return { status: "resolved", placeId: "ChIJ_senso" };
    });
    expect(calls).toEqual([{ name: "浅草寺", area: "淺草" }]);
    expect(rows[0]).toMatchObject({
      name_zh: "淺草寺",
      place_id: "ChIJ_senso",
      verification_status: "unverified",
      research_track: "A",
      constraint_note: null,
      generated_by: generatedBy,
      place_resolution: "resolved",
    });
  });

  it("place_id 解析失敗的候選 place_id 為 null、Unverified，並記錄原因", async () => {
    const rows = await toCandidateRows([{ ...candidate, name_local: null }], "D", generatedBy, async () => ({
      status: "unresolved",
      reason: "name_mismatch",
    }));
    expect(rows[0]).toMatchObject({ place_id: null, verification_status: "unverified", place_resolution: "name_mismatch" });
  });

  it("解析拋出錯誤時視為失敗，不中斷其他候選", async () => {
    const rows = await toCandidateRows([candidate, { ...candidate, name_zh: "雷門", name_local: "雷門" }], "A", generatedBy, async (q) => {
      if (q.name === "浅草寺") throw new Error("network");
      return { status: "resolved", placeId: "ChIJ_kaminarimon" };
    });
    expect(rows.map((r) => [r.place_id, r.place_resolution])).toEqual([
      [null, "error"],
      ["ChIJ_kaminarimon", "resolved"],
    ]);
  });

  it("沒有 Google Maps key 時不解析，全部為 Unverified", async () => {
    const rows = await toCandidateRows([candidate], "B", generatedBy, null);
    expect(rows[0]).toMatchObject({ place_id: null, verification_status: "unverified", place_resolution: "no_key" });
  });
});
