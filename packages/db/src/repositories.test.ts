import { describe, expect, it } from "vitest";
import {
  SupabaseItineraryRepository,
  SupabaseMemoryReader,
  SupabaseNotifier,
  SupabaseProposalRepository,
  type QueryClient,
} from "./index";

// 以可鏈接的假查詢建構器記錄呼叫，回傳預設結果
function fakeClient(result: { data: unknown; error: { message: string } | null }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "insert", "single", "maybeSingle"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result);
  const client = {
    from: (table: string) => {
      calls.push(["from", table]);
      return builder;
    },
  } as unknown as QueryClient;
  return { client, calls };
}

const item = {
  id: "11111111-1111-4111-8111-111111111111",
  trip_id: "22222222-2222-4222-8222-222222222222",
  name_zh: "淺草寺",
  name_local: null,
  place_id: null,
  type: "attraction",
  address: null,
  area: null,
  coord_lat: null,
  coord_lng: null,
  coord_fetched_at: null,
  suggested_stay_minutes: 60,
  availability: [],
  reservation_requirement: "none",
  reservation_note: null,
  constraint_class: "flexible",
  is_fixed: false,
  priority: 3,
  weather_dependency: "medium",
  candidate_role: "primary",
  recommendation_reason: "東京最古老的寺院",
  constraint_note: null,
  score_personal_value: 4,
  score_uniqueness: 5,
  score_geographic_fit: 3,
  score_time_cost: 3,
  score_transport_cost: 4,
  score_weather_dependency: 2,
  score_time_slot_dependency: 2,
  score_substitutability: 1,
  scheduled_date: null,
  scheduled_start: null,
  scheduled_end: null,
  movable_from: null,
  movable_to: null,
  verification_status: "unverified",
  last_verified_at: null,
  sources: [],
  generated_by: null,
  verified_by: null,
  lifecycle_status: "candidate",
  at_risk: false,
  standby: false,
  post_trip_status: null,
  estimated_cost_amount: null,
  estimated_cost_currency: null,
  actual_cost_amount: null,
  actual_cost_currency: null,
  payer_id: null,
  created_at: "2026-11-23T10:00:00+00:00",
};

describe("ItineraryRepository", () => {
  it("依行程讀取項目並以 schema 驗證", async () => {
    const { client, calls } = fakeClient({ data: [item], error: null });
    const items = await new SupabaseItineraryRepository(client).listItems(item.trip_id);
    expect(items).toHaveLength(1);
    expect(items[0]?.name_zh).toBe("淺草寺");
    expect(calls).toContainEqual(["from", "itinerary_items"]);
    expect(calls).toContainEqual(["eq", "trip_id", item.trip_id]);
  });

  it("資料庫回傳不符 schema 的資料時拋出錯誤", async () => {
    const { client } = fakeClient({ data: [{ ...item, priority: 9 }], error: null });
    await expect(new SupabaseItineraryRepository(client).listItems(item.trip_id)).rejects.toThrow();
  });

  it("資料庫錯誤時拋出錯誤，不回傳空清單", async () => {
    const { client } = fakeClient({ data: null, error: { message: "permission denied" } });
    await expect(new SupabaseItineraryRepository(client).listItems(item.trip_id)).rejects.toThrow(
      "itinerary_items",
    );
  });
});

describe("ProposalRepository", () => {
  it("成員提案以 pending 狀態建立並記錄 base version", async () => {
    const proposal = {
      id: "33333333-3333-4333-8333-333333333333",
      trip_id: item.trip_id,
      proposer_member_id: "44444444-4444-4444-8444-444444444444",
      proposer_role: null,
      proposer_provider: null,
      proposer_model: null,
      base_version: 2,
      change: { op: "move" },
      impact_scope: { days: ["2026-12-01"] },
      status: "pending",
      live_branch_id: null,
      decided_by: null,
      decided_at: null,
      created_at: "2026-11-23T10:00:00+00:00",
    };
    const { client, calls } = fakeClient({ data: proposal, error: null });
    const created = await new SupabaseProposalRepository(client).createMemberProposal({
      tripId: proposal.trip_id,
      memberId: proposal.proposer_member_id,
      baseVersion: 2,
      change: proposal.change,
      impactScope: proposal.impact_scope,
    });
    expect(created.status).toBe("pending");
    const insert = calls.find(([m]) => m === "insert");
    expect(insert?.[1]).toMatchObject({ status: "pending", base_version: 2, proposer_role: null });
  });
});

describe("MemoryReader 與 Notifier", () => {
  it("只讀取指定擁有者的記憶", async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    await new SupabaseMemoryReader(client).listForOwner("44444444-4444-4444-8444-444444444444");
    expect(calls).toContainEqual(["eq", "owner_id", "44444444-4444-4444-8444-444444444444"]);
  });

  it("通知寫入收件者與關聯物件", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    await new SupabaseNotifier(client).notify({
      recipientId: "44444444-4444-4444-8444-444444444444",
      tripId: item.trip_id,
      kind: "proposal_applied",
      refTable: "proposals",
      refId: "33333333-3333-4333-8333-333333333333",
    });
    const insert = calls.find(([m]) => m === "insert");
    expect(insert?.[1]).toMatchObject({ recipient_id: "44444444-4444-4444-8444-444444444444", kind: "proposal_applied" });
  });
});
