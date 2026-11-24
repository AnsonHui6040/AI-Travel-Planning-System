import type { CommitResult, ItineraryItem, Proposal } from "@atps/core";
import { describe, expect, it } from "vitest";
import { approveProposalAction, rejectProposalAction, type ProposalsDeps } from "./proposals-core";

// T34：共同批准（SH-04–SH-06）。批准經 core 的 applyChange（第 2.6 節規則、第 2.7 節版本類型），
// 再由資料庫函式比對 base version：先到先得，版本已變更時提案失效

const TRIP = "8d2f0a6e-1c3b-4a5d-9e7f-1234567890ab";
const PROPOSAL = "5c6d7e8f-1a2b-4c3d-8e4f-0a1b2c3d4e5f";
const ITEM = "3b1e9c2d-7f4a-4c8b-a2d1-0f9e8d7c6b5a";

const proposal = (over: Partial<Proposal> = {}): Proposal =>
  ({
    id: PROPOSAL,
    trip_id: TRIP,
    proposer_member_id: "11111111-1111-4111-8111-111111111111",
    proposer_role: null,
    proposer_provider: null,
    proposer_model: null,
    base_version: 2,
    change: {
      changeKind: "minor_non_incident",
      versionKind: "minor",
      summary: "淺草寺改到 10:00",
      operations: [{ op: "schedule_item", itemId: ITEM, date: "2026-12-10", start: "10:00", end: "11:00" }],
    },
    impact_scope: { dates: ["2026-12-10"] },
    status: "pending",
    live_branch_id: null,
    decided_by: null,
    decided_at: null,
    created_at: "2026-11-24T01:00:00+00:00",
    ...over,
  }) as Proposal;

function deps(result: CommitResult, over: Partial<ProposalsDeps> = {}) {
  const calls: unknown[][] = [];
  const logs: string[] = [];
  const d: ProposalsDeps = {
    getUser: async () => ({ id: "me" }),
    checkRateLimit: async () => true,
    loadProposal: async () => proposal(),
    canDecide: async () => true,
    applyDeps: {
      itinerary: { listItems: async () => [{ id: ITEM, scheduled_date: "2026-12-10" } as ItineraryItem] },
      writer: {
        approve: async (input) => {
          calls.push(["approve", input]);
          return result;
        },
        autoApply: async () => result,
        reject: async (input) => {
          calls.push(["reject", input]);
        },
      },
    },
    logError: (m) => logs.push(m),
    ...over,
  };
  return { d, calls, logs };
}

const applied: CommitResult = { outcome: "applied", version: { major: 1, minor: 3 }, invalidatedIds: [] };

describe("approveProposalAction", () => {
  it("批准者取自 session，套用後回報新版本", async () => {
    const { d, calls } = deps(applied);
    expect(await approveProposalAction(d, PROPOSAL)).toEqual({ ok: true, message: "已套用，Change Log 版本 v1.3" });
    expect(calls).toEqual([["approve", { proposalId: PROPOSAL, actorId: "me" }]]);
  });

  it("SH-04：批准時版本已變更，提案失效", async () => {
    const { d } = deps({ outcome: "invalidated" });
    expect(await approveProposalAction(d, PROPOSAL)).toEqual({
      ok: false,
      message: "行程已有其他更新，這個提案已失效。請以最新版本重新提出",
    });
  });

  it("已處理過的提案、找不到的提案、沒有權限時不送出", async () => {
    const done = deps(applied, { loadProposal: async () => proposal({ status: "applied" }) });
    expect((await approveProposalAction(done.d, PROPOSAL)).message).toBe("這個提案已經處理過");
    expect(done.calls).toEqual([]);
    expect((await approveProposalAction(deps(applied, { loadProposal: async () => null }).d, PROPOSAL)).message).toBe("找不到這個提案");
    const viewer = deps(applied, { canDecide: async () => false });
    expect((await approveProposalAction(viewer.d, PROPOSAL)).message).toBe("只有 Owner 與 Companion 可以批准或否決提案");
    expect(viewer.calls).toEqual([]);
  });

  it("未登入、速率限制、參數不正確時不讀取提案", async () => {
    expect((await approveProposalAction(deps(applied, { getUser: async () => null }).d, PROPOSAL)).message).toBe("需要登入");
    expect((await approveProposalAction(deps(applied, { checkRateLimit: async () => false }).d, PROPOSAL)).message).toBe("操作過於頻繁，請稍後再試");
    expect((await approveProposalAction(deps(applied).d, "x")).message).toBe("提案不正確");
  });

  it("套用失敗時只記錄，不外洩細節", async () => {
    const broken = deps(applied, {
      applyDeps: {
        itinerary: { listItems: async () => [] },
        writer: { approve: async () => applied, autoApply: async () => applied, reject: async () => undefined },
      },
    });
    expect((await approveProposalAction(broken.d, PROPOSAL)).message).toBe("批准失敗，請稍後再試");
    expect(broken.logs).toEqual(["批准提案失敗"]);
  });
});

describe("rejectProposalAction", () => {
  it("否決者取自 session", async () => {
    const { d, calls } = deps(applied);
    expect(await rejectProposalAction(d, PROPOSAL)).toEqual({ ok: true, message: "已否決" });
    expect(calls).toEqual([["reject", { proposalId: PROPOSAL, actorId: "me" }]]);
    const done = deps(applied, { loadProposal: async () => proposal({ status: "invalidated" }) });
    expect((await rejectProposalAction(done.d, PROPOSAL)).message).toBe("這個提案已經處理過");
  });
});
