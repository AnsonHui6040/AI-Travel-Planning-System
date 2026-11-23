import { describe, expect, it } from "vitest";
import { applyChange, rejectProposal, type ChangeWriter, type CommitResult, type ItineraryItem, type Proposal } from "./index";

const ITEM = "30000000-0000-4000-8000-000000000001";
const OTHER_DAY_ITEM = "30000000-0000-4000-8000-000000000002";
const MEMBER = "00000000-0000-4000-8000-0000000000b2";

const items = [
  { id: ITEM, scheduled_date: "2026-12-01" },
  { id: OTHER_DAY_ITEM, scheduled_date: "2026-12-02" },
] as unknown as ItineraryItem[];

function proposal(change: Record<string, unknown>, extra: Partial<Proposal> = {}): Proposal {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    trip_id: "20000000-0000-4000-8000-000000000001",
    proposer_member_id: MEMBER,
    proposer_role: null,
    proposer_provider: null,
    proposer_model: null,
    base_version: 3,
    change,
    impact_scope: {},
    status: "pending",
    live_branch_id: null,
    decided_by: null,
    decided_at: null,
    created_at: "2026-11-23T00:00:00Z",
    ...extra,
  } as Proposal;
}

const minor = {
  changeKind: "minor_non_incident",
  versionKind: "minor",
  summary: "淺草寺改到下午",
  operations: [{ op: "schedule_item", itemId: ITEM, date: "2026-12-01", start: "14:00", end: "15:00" }],
};

const l1 = {
  changeKind: "incident_L1",
  versionKind: "minor",
  summary: "延誤 15 分鐘，壓縮緩衝",
  operations: [{ op: "schedule_item", itemId: ITEM, date: "2026-12-01", start: "14:15", end: "15:00" }],
};

const factInvalidated = {
  changeKind: "approved_fact_invalidated",
  versionKind: "minor",
  summary: "臨時休館，標示 At Risk",
  operations: [{ op: "set_at_risk", itemId: ITEM, atRisk: true }],
};

function fakeDeps(result: CommitResult = { outcome: "applied", version: { major: 1, minor: 4 }, invalidatedIds: [] }) {
  const calls: Array<[string, unknown]> = [];
  const writer: ChangeWriter = {
    approve: async (input) => {
      calls.push(["approve", input]);
      return result;
    },
    autoApply: async (input) => {
      calls.push(["autoApply", input]);
      return result;
    },
    reject: async (input) => {
      calls.push(["reject", input]);
    },
  };
  const itinerary = { listItems: async () => items };
  return { deps: { writer, itinerary }, calls };
}

describe("applyChange：唯一寫入函式（S-01）", () => {
  it("需批准的變更由成員批准後交給寫入角色", async () => {
    const { deps, calls } = fakeDeps();
    const result = await applyChange(deps, { proposal: proposal(minor), actorId: MEMBER });
    expect(result).toEqual({ outcome: "applied", version: { major: 1, minor: 4 }, invalidatedIds: [] });
    expect(calls).toEqual([["approve", { proposalId: "40000000-0000-4000-8000-000000000001", actorId: MEMBER }]]);
  });

  it("需批准的變更沒有批准者時拒絕套用（D10）", async () => {
    const { deps, calls } = fakeDeps();
    await expect(applyChange(deps, { proposal: proposal(minor), actorId: null })).rejects.toThrow("需成員批准");
    expect(calls).toEqual([]);
  });

  it("事實失效標示 At Risk 自動套用，不需批准者", async () => {
    const { deps, calls } = fakeDeps();
    await applyChange(deps, {
      proposal: proposal(factInvalidated, { proposer_member_id: null, proposer_role: "live_planner" }),
      actorId: null,
    });
    expect(calls).toEqual([["autoApply", { proposalId: "40000000-0000-4000-8000-000000000001" }]]);
  });

  it("L1 壓縮緩衝沒有使用者確認時拒絕套用（決策 0005）", async () => {
    const { deps, calls } = fakeDeps();
    await expect(
      applyChange(deps, { proposal: proposal(l1, { proposer_member_id: null, proposer_role: "live_planner" }), actorId: null }),
    ).rejects.toThrow("需成員批准");
    expect(calls).toEqual([]);
  });

  it("成員確認 L1 後交給寫入角色", async () => {
    const { deps, calls } = fakeDeps();
    await applyChange(deps, { proposal: proposal(l1), actorId: MEMBER });
    expect(calls[0]?.[0]).toBe("approve");
  });

  it("寫入角色回報版本已變更時，回傳已失效（SH-04）", async () => {
    const { deps } = fakeDeps({ outcome: "invalidated" });
    expect(await applyChange(deps, { proposal: proposal(minor), actorId: MEMBER })).toEqual({ outcome: "invalidated" });
  });

  it("非待批准的提案不可套用", async () => {
    const { deps, calls } = fakeDeps();
    await expect(applyChange(deps, { proposal: proposal(minor, { status: "applied" }), actorId: MEMBER })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("提案內容不符 schema 時拒絕", async () => {
    const { deps, calls } = fakeDeps();
    await expect(applyChange(deps, { proposal: proposal({ changeKind: "x" }), actorId: MEMBER })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("標示的版本類型與第 2.7 節判定不符時拒絕", async () => {
    const { deps, calls } = fakeDeps();
    const crossDay = {
      ...minor,
      operations: [{ op: "schedule_item", itemId: OTHER_DAY_ITEM, date: "2026-12-01", start: "10:00", end: "11:00" }],
    };
    await expect(applyChange(deps, { proposal: proposal(crossDay), actorId: MEMBER })).rejects.toThrow("版本類型");
    expect(calls).toEqual([]);
  });
});

describe("rejectProposal", () => {
  it("成員否決待批准提案", async () => {
    const { deps, calls } = fakeDeps();
    await rejectProposal(deps, { proposal: proposal(minor), actorId: MEMBER });
    expect(calls).toEqual([["reject", { proposalId: "40000000-0000-4000-8000-000000000001", actorId: MEMBER }]]);
  });

  it("非待批准的提案不可否決", async () => {
    const { deps } = fakeDeps();
    await expect(rejectProposal(deps, { proposal: proposal(minor, { status: "rejected" }), actorId: MEMBER })).rejects.toThrow();
  });
});
