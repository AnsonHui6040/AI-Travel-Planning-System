import { describe, expect, it } from "vitest";
import { gateRoleOutput, type GateContext } from "./index";

// T18、S-01、S-03：AI 輸出寫入前的檢查。只產生候選或待批准提案，否則拒絕
const ITEM = "e6000000-0000-4000-8000-000000000001";
const OTHER = "e6000000-0000-4000-8000-000000000002";
const ctx: GateContext = { knownItemIds: new Set([ITEM, OTHER]), forbiddenValues: ["test-only-key-0001", "王小明"] };

const source = { url: "https://www.senso-ji.jp/", fetched_at: "2026-11-23T10:00:00+09:00", grade: "facility_official" };
const candidate = {
  name_zh: "淺草寺",
  name_local: null,
  area: "淺草",
  type: "attraction",
  recommendation_reason: "早上人少",
  suggested_stay_minutes: 60,
  constraints: null,
  sources: [source],
  data_date: "2026-11-23",
};
const proposal = (changeKind: string, itemId = ITEM) => ({
  changeKind,
  versionKind: "minor",
  summary: "調整",
  operations: [{ op: "schedule_item", itemId, date: "2026-12-03", start: "16:00", end: "17:00" }],
});

describe("gateRoleOutput", () => {
  it("Research：候選通過", () => {
    expect(gateRoleOutput("research", { candidates: [candidate] }, ctx)).toMatchObject({ ok: true, role: "research" });
  });

  // T41、MEM-03：AI 沒有記憶寫入權；任何角色的輸出夾帶記憶都在 schema 檢查被拒絕
  it.each(["research", "verification", "transport", "master_planner", "live_planner"] as const)("%s：輸出夾帶記憶時拒絕", (role) => {
    const memory = { layer: "personal", kind: "constraint", item: "每日步行上限", value: "20", unit: "公里" };
    expect(gateRoleOutput(role, { candidates: [], proposals: [], memories: [memory] }, ctx)).toMatchObject({ ok: false, reason: "schema" });
  });

  it("Planner：需要批准的提案通過", () => {
    expect(gateRoleOutput("live_planner", { proposals: [proposal("minor_non_incident")] }, ctx)).toMatchObject({ ok: true });
  });

  it.each(["new_candidate", "candidate_verification_update", "approved_fact_invalidated"])(
    "Planner 提出會自動套用的種類 %s 時拒絕",
    (kind) => {
      expect(gateRoleOutput("master_planner", { proposals: [proposal(kind)] }, ctx)).toMatchObject({ ok: false, reason: "auto_kind" });
    },
  );

  it("操作不存在的項目時拒絕", () => {
    const result = gateRoleOutput("live_planner", { proposals: [proposal("minor_non_incident", "e6000000-0000-4000-8000-0000000000ff")] }, ctx);
    expect(result).toMatchObject({ ok: false, reason: "unknown_item" });
  });

  it("Verification、Transport 只能針對已知項目", () => {
    const verification = { results: [{ item_id: "e6000000-0000-4000-8000-0000000000ff", status: "verified", findings: "x", sources: [source] }] };
    expect(gateRoleOutput("verification", verification, ctx)).toMatchObject({ ok: false, reason: "unknown_item" });
    const transport = {
      segments: [
        {
          from_item_id: ITEM,
          to_item_id: "e6000000-0000-4000-8000-0000000000ff",
          estimates: [
            {
              mode: "rail",
              door_to_door_minutes: 20,
              price: { amount: 200, currency: "JPY" },
              walk_minutes: 5,
              transfers: 0,
              luggage_friendliness: "medium",
              comfort: "medium",
              delay_risk: "low",
              sources: [source],
            },
          ],
          sources: [source],
        },
      ],
    };
    expect(gateRoleOutput("transport", transport, ctx)).toMatchObject({ ok: false, reason: "unknown_item" });
  });

  it("輸出含 API key 或未開放的敏感欄位值時拒絕，原因不含該值", () => {
    const leak = gateRoleOutput("research", { candidates: [{ ...candidate, recommendation_reason: "key 是 test-only-key-0001" }] }, ctx);
    expect(leak).toMatchObject({ ok: false, reason: "leak" });
    expect(JSON.stringify(leak)).not.toContain("test-only-key-0001");
    const url = { ...source, url: "https://evil.example/c?d=%E7%8E%8B%E5%B0%8F%E6%98%8E" };
    expect(gateRoleOutput("research", { candidates: [{ ...candidate, sources: [url] }] }, ctx)).toMatchObject({ ok: false, reason: "leak" });
  });

  it("不符角色 schema 的輸出拒絕（多出的欄位、其他角色的格式）", () => {
    expect(gateRoleOutput("research", { candidates: [candidate], memory: [{ item: "x" }] }, ctx)).toMatchObject({ ok: false, reason: "schema" });
    expect(gateRoleOutput("research", { proposals: [proposal("minor_non_incident")] }, ctx)).toMatchObject({ ok: false, reason: "schema" });
  });
});
