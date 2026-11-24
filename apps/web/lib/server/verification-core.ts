import {
  canEnterDraft,
  crossCheck,
  findDuplicateGroups,
  handleRoleRun,
  type FactClaimRecord,
  type HandledRun,
  type ModelRef,
  type ResearchCandidate,
  type ResolvedFact,
  type RoleOutputSink,
  type RoleRunDeps,
  type RoleSetting,
  type RoleSpec,
  type VerificationStatus,
} from "@atps/core";
import type { RoleOutputs } from "@atps/schemas";
import { composeRoleInput } from "@atps/security";

// T25：合併、去重、交叉核查的伺服器邏輯。
// 去重：findDuplicateGroups 判定，逐組經資料庫函式合併。
// 核實：Verification 以候選資料（資料區塊，S-03）逐批核對；輸出經 handleRoleRun 檢查，
// 再與 Research 的事實主張依證據順序交叉判定（crossCheck），只寫入核實結果。

type SourceRef = ResearchCandidate["sources"][number];
type AvailabilitySlot = RoleOutputs["verification"]["results"][number]["availability"][number];

export interface CandidateForCheck {
  id: string;
  name_zh: string;
  name_local: string | null;
  area: string | null;
  type: ResearchCandidate["type"];
  place_id: string | null;
  coord_lat: number | null;
  coord_lng: number | null;
  created_at: string;
  recommendation_reason: string;
  constraint_note: string | null;
  sources: SourceRef[];
  generated_by: ModelRef | null;
  fact_claims: FactClaimRecord[];
}

export interface DedupeDeps {
  // 研究 job 所屬行程中尚未進入行程的候選
  listCandidates: (jobId: string) => Promise<CandidateForCheck[]>;
  merge: (jobId: string, keep: string, drop: string[]) => Promise<number>;
}

export async function dedupeCandidates(deps: DedupeDeps, jobId: string): Promise<number> {
  const groups = findDuplicateGroups(await deps.listCandidates(jobId));
  let merged = 0;
  for (const group of groups) merged += await deps.merge(jobId, group.keep, group.drop);
  return merged;
}

// ---- 交叉核查 ----------------------------------------------------------------

export interface VerificationWrite {
  itemId: string;
  status: VerificationStatus;
  facts: ResolvedFact[];
  claims: FactClaimRecord[];
  sources: SourceRef[];
  verifiedBy: ModelRef;
  // T30：只在核實通過（Verified、Partially Verified）時寫入營業時段
  availability: AvailabilitySlot[];
  reservation: "none" | "recommended" | "required";
}

export interface VerificationContext {
  tripId: string;
  initiatorId: string;
  setting: RoleSetting;
  forbiddenValues: string[];
}

export interface VerificationDeps extends RoleRunDeps {
  loadContext: (jobId: string) => Promise<VerificationContext | null>;
  // 只回傳 job 所屬行程中的項目
  loadCandidates: (jobId: string, itemIds: readonly string[]) => Promise<CandidateForCheck[]>;
  applyVerification: (jobId: string, write: VerificationWrite) => Promise<void>;
}

export interface VerificationChunkRun {
  jobId: string;
  itemIds: string[];
  role: RoleSpec;
  providerIndex?: number;
}

export const VERIFICATION_CHUNK_SIZE = 10;

const TASK =
  "Verification：逐項核對資料區塊中的候選。以官方資訊優先，核對營業時間、休館日、門票、預約與交通服務；每個候選輸出 item_id、核實狀態、發現、來源，以及核對到的事實（各附來源網址、取得時間與來源等級）。另輸出營業時段 availability（依星期 weekday 0–6，星期日為 0，或指定日期 date；休館日不列）與預約需求 reservation（none、recommended、required）。無法確認時標示 unverified，來源互相矛盾時標示 conflict。";

function candidateData(candidates: readonly CandidateForCheck[]): string {
  const data = candidates.map((c) => ({
    item_id: c.id,
    名稱: c.name_zh,
    當地名稱: c.name_local,
    地區: c.area,
    類型: c.type,
    推薦原因: c.recommendation_reason,
    限制: c.constraint_note,
    來源: c.sources,
    Research的事實主張: c.fact_claims.map((f) => ({ 欄位: f.field, 內容: f.value, 來源: f.source })),
  }));
  return JSON.stringify(data, null, 2);
}

export async function runVerificationChunk(deps: VerificationDeps, run: VerificationChunkRun): Promise<HandledRun> {
  const context = await deps.loadContext(run.jobId);
  if (!context) return { status: "rejected", reason: "schema", detail: "研究 job 不存在或已沒有權限" };
  const candidates = await deps.loadCandidates(run.jobId, run.itemIds);
  if (candidates.length === 0) return { status: "stored", kind: "verification", count: 0 };

  const entry = context.setting.chain[run.providerIndex ?? 0];
  const verifiedBy: ModelRef = { provider: entry?.provider ?? "google", model: entry?.model ?? "" };
  const byId = new Map(candidates.map((c) => [c.id, c]));

  const sink: RoleOutputSink = {
    addCandidates: async () => undefined,
    addVerificationResults: async (_tripId, results) => {
      for (const r of results) {
        const item = byId.get(r.item_id);
        if (!item) continue;
        const claims: FactClaimRecord[] = r.facts.map((f) => ({ ...f, by: verifiedBy }));
        const checked = crossCheck(item, { status: r.status, facts: claims, verifiedBy });
        await deps.applyVerification(run.jobId, {
          itemId: item.id,
          status: checked.status,
          facts: checked.facts,
          claims,
          sources: r.sources,
          verifiedBy,
          availability: canEnterDraft(checked.status) ? r.availability : [],
          reservation: r.reservation,
        });
      }
    },
    addSegments: async () => undefined,
    addPendingProposals: async () => undefined,
  };

  return handleRoleRun(
    { ...deps, sink },
    {
      role: run.role,
      setting: context.setting,
      input: composeRoleInput(TASK, [{ kind: "trip", content: candidateData(candidates) }]),
      ownerId: context.initiatorId,
      jobId: run.jobId,
      ...(run.providerIndex === undefined ? {} : { providerIndex: run.providerIndex }),
    },
    { tripId: context.tripId, baseVersion: 0, knownItemIds: new Set(byId.keys()), forbiddenValues: context.forbiddenValues },
  );
}
