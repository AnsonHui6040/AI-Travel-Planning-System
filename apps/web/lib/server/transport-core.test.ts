import { roleSpec } from "@atps/ai";
import { defaultRoleSetting, type ProviderAdapter, type ProviderRequest } from "@atps/core";
import { describe, expect, it } from "vitest";
import { runTransportSegments, type SegmentWrite, type TransportDeps } from "./transport-core";

// T28：交通動線比較的伺服器邏輯（D27、D29）

const JOB = "a3000000-0000-4000-8000-000000000001";
const A = "a4000000-0000-4000-8000-000000000001";
const B = "a4000000-0000-4000-8000-000000000002";
const src = { url: "https://railway.example.jp/route", fetched_at: "2026-11-24T10:00:00+09:00", grade: "official_transport_tourism" };
const rail = {
  mode: "rail",
  door_to_door_minutes: 18,
  price: { amount: 180, currency: "JPY" },
  walk_minutes: 8,
  transfers: 1,
  luggage_friendliness: "medium",
  comfort: "medium",
  delay_risk: "medium",
  sources: [src],
};
const output = { segments: [{ from_item_id: A, to_item_id: B, estimates: [rail], sources: [src] }] };

function deps(result: unknown, over: Partial<TransportDeps> = {}) {
  const requests: ProviderRequest[] = [];
  const writes: SegmentWrite[][] = [];
  const adapter: ProviderAdapter = {
    id: "anthropic",
    authMethods: ["api_key"],
    builtInSearch: true,
    generate: async (request) => {
      requests.push(request);
      return { output: result, usage: { inputTokens: 10, outputTokens: 10 }, citations: [] };
    },
    classifyError: () => "unknown",
  };
  const d: TransportDeps = {
    adapterFor: () => adapter,
    credentialFor: async () => ({ kind: "api_key", secret: "test-only-key-0005" }),
    recordUsage: async () => undefined,
    loadContext: async () => ({
      tripId: "a2000000-0000-4000-8000-000000000001",
      initiatorId: "00000000-0000-4000-8000-0000000000a1",
      setting: defaultRoleSetting("transport"),
      forbiddenValues: ["test-only-key-0005"],
      transportPreferences: [],
      items: [
        { id: A, name_zh: "淺草寺", name_local: "浅草寺", area: "淺草", place_id: "ChIJ_senso_place_0001" },
        { id: B, name_zh: "上野公園", name_local: "上野恩賜公園", area: "上野", place_id: null },
      ],
    }),
    storeSegments: async (_job, segments) => {
      writes.push(segments);
      return segments.length;
    },
    ...over,
  };
  return { deps: d, requests, writes };
}

describe("runTransportSegments", () => {
  it("每段寫入含緩衝的估算、四種方案與開啟對應路段的 Google Maps 連結", async () => {
    const { deps: d, requests, writes } = deps(output);
    const result = await runTransportSegments(d, { jobId: JOB, pairs: [{ from: A, to: B }], role: roleSpec("transport") });
    expect(result).toEqual({ status: "stored", kind: "segments", count: 1 });
    const [segment] = writes[0] ?? [];
    expect(segment).toMatchObject({
      from_item_id: A,
      to_item_id: B,
      buffer_minutes: 15,
      recommended_mode: "rail",
      plans: { recommended: "rail", fastest: "rail", cheapest: "rail", comfortable: "rail" },
      source_urls: ["https://railway.example.jp/route"],
    });
    expect(segment?.estimates[0]).toMatchObject({ buffer_minutes: 15, total_minutes: 33, source_urls: ["https://railway.example.jp/route"] });
    const url = new URL(segment?.maps_url ?? "");
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("origin")).toBe("浅草寺");
    expect(url.searchParams.get("origin_place_id")).toBe("ChIJ_senso_place_0001");
    expect(url.searchParams.get("destination")).toBe("上野恩賜公園");
    expect(url.searchParams.get("travelmode")).toBe("transit");
    // D29：送給 AI 的輸入不含 place_id
    expect(requests[0]?.input).not.toContain("ChIJ_senso_place_0001");
    expect(requests[0]?.input).toContain("上野");
  });

  it("估算缺來源時整份拒絕", async () => {
    const noSources = Object.fromEntries(Object.entries(rail).filter(([key]) => key !== "sources"));
    const { deps: d, writes } = deps({ segments: [{ from_item_id: A, to_item_id: B, estimates: [noSources], sources: [src] }] });
    expect(await runTransportSegments(d, { jobId: JOB, pairs: [{ from: A, to: B }], role: roleSpec("transport") })).toMatchObject({
      status: "rejected",
    });
    expect(writes).toEqual([]);
  });

  it("輸出的路段不在要求的路段內時不寫入該段", async () => {
    const { deps: d, writes } = deps({ segments: [{ from_item_id: B, to_item_id: A, estimates: [rail], sources: [src] }] });
    expect(await runTransportSegments(d, { jobId: JOB, pairs: [{ from: A, to: B }], role: roleSpec("transport") })).toEqual({
      status: "stored",
      kind: "segments",
      count: 1,
    });
    expect(writes).toEqual([[]]);
  });

  it("沒有路段時不呼叫 AI", async () => {
    const { deps: d, requests } = deps(output);
    expect(await runTransportSegments(d, { jobId: JOB, pairs: [], role: roleSpec("transport") })).toEqual({ status: "stored", kind: "segments", count: 0 });
    expect(requests).toEqual([]);
  });
});
