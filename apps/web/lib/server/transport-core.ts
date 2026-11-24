import {
  comparePlans,
  handleRoleRun,
  withBuffer,
  type AiMobilityEstimate,
  type HandledRun,
  type RoleOutputSink,
  type RoleRunDeps,
  type RoleSetting,
  type RoleSpec,
  type SegmentPlans,
  type StoredMobilityEstimate,
  type TransportMode,
} from "@atps/core";
import { directionsUrl } from "@atps/data-sources";
import type { TripBaselineData } from "@atps/schemas";
import { composeRoleInput } from "@atps/security";

// T28：交通動線比較的伺服器邏輯（D27、D29、決策 0008）。
// Transport AI 依官方資料估算每段的各交通方式（每個估算附來源）；伺服器加上固定緩衝、比較四種方案，
// 並附開啟對應路段的 Google Maps 連結。送給 AI 的輸入只含名稱與地區，不含 place_id（D29）。

export interface TransportItem {
  id: string;
  name_zh: string;
  name_local: string | null;
  area: string | null;
  place_id: string | null;
}

export interface TransportContext {
  tripId: string;
  initiatorId: string;
  setting: RoleSetting;
  forbiddenValues: string[];
  transportPreferences: TripBaselineData["transport_preferences"];
  items: TransportItem[];
}

export interface SegmentWrite {
  from_item_id: string;
  to_item_id: string;
  estimates: StoredMobilityEstimate[];
  buffer_minutes: number;
  recommended_mode: TransportMode;
  plans: SegmentPlans;
  source_urls: string[];
  maps_url: string;
}

export interface TransportDeps extends RoleRunDeps {
  loadContext: (jobId: string) => Promise<TransportContext | null>;
  storeSegments: (jobId: string, segments: SegmentWrite[]) => Promise<number>;
}

export interface TransportRun {
  jobId: string;
  pairs: { from: string; to: string }[];
  role: RoleSpec;
  providerIndex?: number;
}

export const SEGMENTS_PER_CHUNK = 5;

const TRAVEL_MODE: Record<TransportMode, "transit" | "walking" | "driving"> = {
  walk: "walking",
  rail: "transit",
  bus: "transit",
  taxi: "driving",
  drive: "driving",
};

const TASK =
  "交通估算：依官方交通資料，逐段估算步行、鐵路與地鐵、公車、計程車與叫車、自駕的門到門時間、價格、步行分鐘、轉乘次數、行李便利、舒適度與延誤風險。只輸出資料區塊列出的路段；每個估算附來源網址與取得時間。所有數字都是估算。";

const label = (item: TransportItem) => item.name_local ?? item.name_zh;

export async function runTransportSegments(deps: TransportDeps, run: TransportRun): Promise<HandledRun> {
  if (run.pairs.length === 0) return { status: "stored", kind: "segments", count: 0 };
  const context = await deps.loadContext(run.jobId);
  if (!context) return { status: "rejected", reason: "schema", detail: "研究 job 不存在或已沒有權限" };

  const byId = new Map(context.items.map((i) => [i.id, i]));
  const pairs = run.pairs.filter((p) => byId.has(p.from) && byId.has(p.to));
  const wanted = new Set(pairs.map((p) => `${p.from}>${p.to}`));
  // D29：只送名稱與地區
  const data = pairs.map((p) => {
    const from = byId.get(p.from);
    const to = byId.get(p.to);
    return {
      from_item_id: p.from,
      起點: from?.name_zh,
      起點當地名稱: from?.name_local,
      起點地區: from?.area,
      to_item_id: p.to,
      終點: to?.name_zh,
      終點當地名稱: to?.name_local,
      終點地區: to?.area,
    };
  });

  const sink: RoleOutputSink = {
    addCandidates: async () => undefined,
    addVerificationResults: async () => undefined,
    addPendingProposals: async () => undefined,
    addSegments: async (_tripId, segments) => {
      const rows: SegmentWrite[] = [];
      for (const segment of segments) {
        const from = byId.get(segment.from_item_id);
        const to = byId.get(segment.to_item_id);
        if (!from || !to || !wanted.has(`${segment.from_item_id}>${segment.to_item_id}`)) continue;
        const estimates = segment.estimates.map((e) => withBuffer(e as AiMobilityEstimate));
        const plans = comparePlans(estimates, context.transportPreferences);
        const recommended = estimates.find((e) => e.mode === plans.recommended) ?? estimates[0];
        if (!recommended) continue;
        rows.push({
          from_item_id: from.id,
          to_item_id: to.id,
          estimates,
          buffer_minutes: recommended.buffer_minutes,
          recommended_mode: plans.recommended,
          plans,
          source_urls: [...new Set([...segment.sources.map((s) => s.url), ...estimates.flatMap((e) => e.source_urls)])].slice(0, 10),
          maps_url: directionsUrl({
            origin: label(from),
            originPlaceId: from.place_id,
            destination: label(to),
            destinationPlaceId: to.place_id,
            travelmode: TRAVEL_MODE[plans.recommended],
          }),
        });
      }
      await deps.storeSegments(run.jobId, rows);
    },
  };

  return handleRoleRun(
    { ...deps, sink },
    {
      role: run.role,
      setting: context.setting,
      input: composeRoleInput(TASK, [{ kind: "trip", content: JSON.stringify(data, null, 2) }]),
      ownerId: context.initiatorId,
      jobId: run.jobId,
      ...(run.providerIndex === undefined ? {} : { providerIndex: run.providerIndex }),
    },
    {
      tripId: context.tripId,
      baseVersion: 0,
      knownItemIds: new Set(pairs.flatMap((p) => [p.from, p.to])),
      forbiddenValues: context.forbiddenValues,
    },
  );
}
