import {
  PROVIDER_NAMES,
  handleRoleRun,
  researchTrackInput,
  toCandidateRows,
  type AiProvider,
  type CandidateRow,
  type HandledRun,
  type PlaceResolver,
  type ResearchTrackId,
  type RoleOutputSink,
  type RoleRunDeps,
  type RoleSetting,
  type RoleSpec,
} from "@atps/core";
import { memoryBlockContent, type MergedMemory } from "@atps/memory";
import { composeRoleInput } from "@atps/security";
import { uuid, type TripBaselineData } from "@atps/schemas";

// T24：多 AI 獨立研究的伺服器邏輯。
// 開始：權限（Owner、Companion）、行程狀態（已確認基線）、Research 的模型與發起人本人的 key 先檢查，再建立 job。
// 執行：每個方向各自以行程與基線組成輸入（S-03），不讀其他方向的結果；輸出經 handleRoleRun 檢查後只寫入 Candidate List。

export interface ResearchStartDeps {
  getUser: () => Promise<{ id: string } | null>;
  checkRateLimit: (endpoint: string, limit: number, windowSeconds: number) => Promise<boolean>;
  // 以使用者 session 讀取（受 RLS 限制）；非成員回傳 null
  loadTrip: (tripId: string) => Promise<{ status: string; role: "owner" | "companion" | "viewer" } | null>;
  loadResearchSetting: (userId: string) => Promise<RoleSetting>;
  hasKey: (provider: AiProvider) => Promise<boolean>;
  createJob: (tripId: string, userId: string) => Promise<string>;
  startWorkflow: (input: { jobId: string }) => Promise<void>;
  failJob: (jobId: string) => Promise<void>;
  logError: (message: string) => void;
}

export interface ResearchStartResult {
  ok: boolean;
  message: string;
  jobId?: string;
}

const RATE = { endpoint: "research.start", limit: 5, windowSeconds: 600 } as const;
const RESEARCH_STATES = new Set(["planning", "locked", "in_progress"]);

export async function startResearchAction(deps: ResearchStartDeps, tripIdRaw: unknown): Promise<ResearchStartResult> {
  const user = await deps.getUser();
  if (!user) return { ok: false, message: "需要登入" };
  if (!(await deps.checkRateLimit(RATE.endpoint, RATE.limit, RATE.windowSeconds))) return { ok: false, message: "操作過於頻繁，請稍後再試" };
  if (typeof tripIdRaw !== "string" || !uuid.safeParse(tripIdRaw).success) return { ok: false, message: "行程不正確" };
  const tripId = tripIdRaw;

  const trip = await deps.loadTrip(tripId);
  if (!trip) return { ok: false, message: "找不到這個行程，或你不是成員。" };
  if (trip.role === "viewer") return { ok: false, message: "只有 Owner 與 Companion 可以開始研究" };
  if (!RESEARCH_STATES.has(trip.status)) return { ok: false, message: "請先確認 Trip Baseline v1 再開始研究" };

  // 只檢查第一順位：備援由使用者確認後才切換（C-08）
  const setting = await deps.loadResearchSetting(user.id);
  const first = setting.chain[0];
  if (!first) return { ok: false, message: "尚未設定 Research 的模型" };
  const name = PROVIDER_NAMES[first.provider];
  if (first.model === null) return { ok: false, message: `尚未選擇 ${name} 的模型` };
  if (!(await deps.hasKey(first.provider))) return { ok: false, message: `尚未設定 ${name} 的 API key` };

  const jobId = await deps.createJob(tripId, user.id);
  try {
    await deps.startWorkflow({ jobId });
  } catch {
    deps.logError("研究 job 啟動失敗");
    await deps.failJob(jobId);
    return { ok: false, message: "無法開始研究，請稍後再試" };
  }
  return { ok: true, message: "已開始研究，四個方向平行執行", jobId };
}

// ---- 單一研究方向 ------------------------------------------------------------

export type CandidateInsert = Omit<CandidateRow, "place_resolution" | "data_date" | "research_track">;

export interface ResearchJobContext {
  tripId: string;
  initiatorId: string;
  trip: { name: string; destination: string | null };
  baseline: TripBaselineData;
  setting: RoleSetting;
  // 發起人的 API key：輸出含有時拒絕（S-02）
  forbiddenValues: string[];
  // T41：目前成員合併後的記憶（MEM-07、MEM-08；不含來源成員），依角色記憶範圍放入資料區塊（MEM-11）
  memories?: MergedMemory[];
}

export interface ResearchTrackDeps extends RoleRunDeps {
  // job 為執行中的 research job、發起人仍有編輯權、基線已確認時回傳；否則 null
  loadContext: (jobId: string) => Promise<ResearchJobContext | null>;
  // 沒有 Google Maps key 時為 null：候選不解析 place_id，維持 Unverified
  resolvePlace: PlaceResolver | null;
  storeCandidates: (jobId: string, track: ResearchTrackId, rows: CandidateInsert[]) => Promise<number>;
}

export interface ResearchTrackRun {
  jobId: string;
  track: ResearchTrackId;
  role: RoleSpec;
  providerIndex?: number;
}

export async function runResearchTrack(deps: ResearchTrackDeps, run: ResearchTrackRun): Promise<HandledRun> {
  const context = await deps.loadContext(run.jobId);
  if (!context) return { status: "rejected", reason: "schema", detail: "研究 job 不存在或已沒有權限" };

  const { task, blocks } = researchTrackInput(run.track, { trip: context.trip, baseline: context.baseline });
  const memory = memoryBlockContent(context.memories ?? [], run.role.memoryScope);
  const allBlocks = memory ? [...blocks, { kind: "member_preference" as const, source: "成員記憶", content: memory }] : blocks;
  const entry = context.setting.chain[run.providerIndex ?? 0];
  const generatedBy = { provider: entry?.provider ?? "anthropic", model: entry?.model ?? "" };

  const sink: RoleOutputSink = {
    addCandidates: async (_tripId, candidates) => {
      if (candidates.length === 0) return;
      const rows = await toCandidateRows(candidates, run.track, generatedBy, deps.resolvePlace);
      await deps.storeCandidates(
        run.jobId,
        run.track,
        rows.map(({ place_resolution: _r, data_date: _d, research_track: _t, ...row }) => row),
      );
    },
    // Research 只產生候選；其他去處不會被呼叫
    addVerificationResults: async () => undefined,
    addSegments: async () => undefined,
    addPendingProposals: async () => undefined,
  };

  return handleRoleRun(
    { ...deps, sink },
    {
      role: run.role,
      setting: context.setting,
      input: composeRoleInput(task, allBlocks),
      ownerId: context.initiatorId,
      jobId: run.jobId,
      ...(run.providerIndex === undefined ? {} : { providerIndex: run.providerIndex }),
    },
    { tripId: context.tripId, baseVersion: 0, knownItemIds: new Set(), forbiddenValues: context.forbiddenValues },
  );
}
