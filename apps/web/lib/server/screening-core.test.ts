import type { TripBaselineData } from "@atps/schemas";
import { describe, expect, it } from "vitest";
import { screenJobCandidates, type ScreeningDeps } from "./screening-core";

// T26：研究 job 的候選篩選

const baseline: TripBaselineData = {
  start_date: "2026-12-01",
  end_date: "2026-12-05",
  timezone: "Asia/Tokyo",
  flights: [],
  lodgings: [],
  companions: 1,
  stamina_note: null,
  budget: null,
  fixed_activities: [],
  paid_items: [],
  must_visit: ["淺草寺"],
  excluded: [],
  transport_preferences: [],
  photography_needs: null,
};

const candidate = (id: string, name: string) => ({
  id,
  name_zh: name,
  name_local: null,
  area: "淺草",
  type: "attraction" as const,
  suggested_stay_minutes: 60,
  research_track: "A" as const,
  fact_claims: [],
});

describe("screenJobCandidates", () => {
  it("以基線評分所有候選並一次寫入", async () => {
    const writes: unknown[][] = [];
    const deps: ScreeningDeps = {
      loadBaseline: async () => baseline,
      listCandidates: async () => [candidate("a", "淺草寺"), candidate("b", "雷門")],
      applyScores: async (_job, results) => {
        writes.push(results);
        return results.length;
      },
    };
    expect(await screenJobCandidates(deps, "job")).toBe(2);
    expect(writes[0]).toHaveLength(2);
    expect(writes[0]?.[0]).toMatchObject({ item_id: "a", candidate_role: "primary", scores: { personal_value: 5 } });
  });

  it("沒有已確認的基線或沒有候選時不寫入", async () => {
    let called = false;
    const deps: ScreeningDeps = {
      loadBaseline: async () => null,
      listCandidates: async () => [candidate("a", "淺草寺")],
      applyScores: async () => {
        called = true;
        return 0;
      },
    };
    expect(await screenJobCandidates(deps, "job")).toBe(0);
    expect(await screenJobCandidates({ ...deps, loadBaseline: async () => baseline, listCandidates: async () => [] }, "job")).toBe(0);
    expect(called).toBe(false);
  });
});
