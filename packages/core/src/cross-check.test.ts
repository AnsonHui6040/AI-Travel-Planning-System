import { describe, expect, it } from "vitest";
import { canEnterDraft, crossCheck, EVIDENCE_ORDER, resolveFact, type FactClaimRecord, type ModelRef } from "./index";

// T25：交叉核查。證據順序：設施官方、官方交通或旅遊局、可靠第三方、使用者評論（第 2.5 節）

const claude: ModelRef = { provider: "anthropic", model: "claude-opus-5-5" };
const gemini: ModelRef = { provider: "google", model: "gemini-model" };
const claim = (value: string, grade: FactClaimRecord["source"]["grade"], by: ModelRef = claude, field: FactClaimRecord["field"] = "opening_hours"): FactClaimRecord => ({
  field,
  value,
  source: { url: `https://${grade}.example/`, fetched_at: "2026-11-23T10:00:00+09:00", grade },
  by,
});

describe("EVIDENCE_ORDER", () => {
  it("設施官方 > 官方交通或旅遊局 > 可靠第三方 > 使用者評論", () => {
    expect(EVIDENCE_ORDER).toEqual(["facility_official", "official_transport_tourism", "reliable_third_party", "user_reviews"]);
  });
});

describe("resolveFact", () => {
  it("採用證據順序最高的來源；較低來源的不同值不影響", () => {
    expect(resolveFact([claim("10:00–18:00", "reliable_third_party"), claim("09:00–17:00", "facility_official", gemini)])).toEqual({
      field: "opening_hours",
      status: "resolved",
      value: "09:00–17:00",
      grade: "facility_official",
    });
  });

  it("最高等級的來源之間不一致時為 conflict", () => {
    expect(resolveFact([claim("09:00–17:00", "facility_official"), claim("10:00–18:00", "facility_official", gemini)])).toEqual({
      field: "opening_hours",
      status: "conflict",
      value: null,
      grade: "facility_official",
    });
  });

  it("寫法差異（全形、空白）不算不一致", () => {
    expect(resolveFact([claim("09:00 – 17:00", "reliable_third_party"), claim("０９:００–１７:００", "reliable_third_party", gemini)])).toMatchObject({
      status: "resolved",
    });
  });
});

describe("crossCheck", () => {
  const item = { generated_by: claude, fact_claims: [claim("10:00–18:00", "reliable_third_party")] };

  it("E4：兩個 AI 的營業時間不同，依證據順序採用官方資訊", () => {
    const result = crossCheck(item, { status: "verified", facts: [claim("09:00–17:00", "facility_official", gemini)], verifiedBy: gemini });
    expect(result.status).toBe("verified");
    expect(result.facts).toEqual([{ field: "opening_hours", status: "resolved", value: "09:00–17:00", grade: "facility_official" }]);
    expect(canEnterDraft(result.status)).toBe(true);
  });

  it("E4：無法判定（同等級來源不一致）時標示 Conflict，不得進入行程", () => {
    const result = crossCheck(item, { status: "verified", facts: [claim("11:00–19:00", "reliable_third_party", gemini)], verifiedBy: gemini });
    expect(result.status).toBe("conflict");
    expect(canEnterDraft(result.status)).toBe(false);
  });

  it("營業時間等關鍵事實只有非官方來源時，最高為 Partially Verified", () => {
    const result = crossCheck(item, { status: "verified", facts: [claim("10:00–18:00", "reliable_third_party", gemini)], verifiedBy: gemini });
    expect(result.status).toBe("partially_verified");
  });

  it("Research 與 Verification 為同一家時最高為 Partially Verified（D07）", () => {
    const result = crossCheck(item, { status: "verified", facts: [claim("09:00–17:00", "facility_official")], verifiedBy: claude });
    expect(result.status).toBe("partially_verified");
  });

  it("Verification 判定為 Unverified 或 Conflict 時維持", () => {
    expect(crossCheck(item, { status: "unverified", facts: [], verifiedBy: gemini }).status).toBe("unverified");
    expect(crossCheck(item, { status: "conflict", facts: [], verifiedBy: gemini }).status).toBe("conflict");
  });

  it("沒有關鍵事實的項目依 Verification 判定", () => {
    const noFacts = { generated_by: claude, fact_claims: [] };
    expect(crossCheck(noFacts, { status: "verified", facts: [], verifiedBy: gemini }).status).toBe("verified");
  });

  it("不同欄位分別判定；任一欄位 conflict 即為 Conflict", () => {
    const result = crossCheck(item, {
      status: "verified",
      facts: [
        claim("09:00–17:00", "facility_official", gemini),
        claim("500 円", "facility_official", gemini, "admission"),
        claim("免費", "facility_official", gemini, "admission"),
      ],
      verifiedBy: gemini,
    });
    expect(result.facts.map((f) => [f.field, f.status])).toEqual([
      ["opening_hours", "resolved"],
      ["admission", "conflict"],
    ]);
    expect(result.status).toBe("conflict");
  });
});
