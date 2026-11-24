import {
  ensureZoneBackups,
  gateZoningOutput,
  normalizePlaceName,
  runRole,
  zoningInput,
  type RoleRunDeps,
  type RoleRunResult,
  type RoleSetting,
  type RoleSpec,
  type ZoningCandidate,
  type ZoningRejection,
} from "@atps/core";
import type { TripBaselineData, ZoningOutput } from "@atps/schemas";
import { composeRoleInput } from "@atps/security";

// T27：地理分區的伺服器邏輯（D29）。
// 以 Transport 的模型設定執行分區；輸入只含候選名稱、地區、類型與停留時間，不含 Google Maps 內容。
// 輸出經 gateZoningOutput 檢查後寫入；每個主要區域沒有 Backup 時，把總分最低的 Primary 改為 Backup（必去地點除外）。

export interface ZoningContext {
  tripId: string;
  initiatorId: string;
  trip: { name: string; destination: string | null };
  baseline: TripBaselineData;
  setting: RoleSetting;
  forbiddenValues: string[];
  // total：T26 的篩選總分
  candidates: (ZoningCandidate & { total: number })[];
}

export interface ZoningWrite {
  zones: ZoningOutput["zones"];
  roles: { item_id: string; candidate_role: "backup" }[];
}

export interface ZoningDeps extends RoleRunDeps {
  loadContext: (jobId: string) => Promise<ZoningContext | null>;
  applyZoning: (jobId: string, write: ZoningWrite) => Promise<number>;
}

export type ZoningRun =
  | { status: "stored"; zones: number; backups: number }
  | { status: "rejected"; reason: ZoningRejection; detail: string }
  | { status: "skipped"; reason: string }
  | { status: "not_completed"; run: RoleRunResult["status"] };

export async function runZoning(deps: ZoningDeps, run: { jobId: string; spec: RoleSpec; providerIndex?: number }): Promise<ZoningRun> {
  const context = await deps.loadContext(run.jobId);
  if (!context) return { status: "skipped", reason: "研究 job 不存在或已沒有權限" };
  if (context.candidates.length < 2) return { status: "skipped", reason: "候選少於 2 個" };

  const { task, blocks } = zoningInput(context);
  const result = await runRole(deps, {
    role: run.spec,
    setting: context.setting,
    input: composeRoleInput(task, blocks),
    ownerId: context.initiatorId,
    jobId: run.jobId,
    ...(run.providerIndex === undefined ? {} : { providerIndex: run.providerIndex }),
  });
  if (result.status === "output_invalid") return { status: "rejected", reason: "schema", detail: result.reason };
  if (result.status !== "completed") return { status: "not_completed", run: result.status };

  const gated = gateZoningOutput(result.output, {
    knownItemIds: new Set(context.candidates.map((c) => c.id)),
    forbiddenValues: context.forbiddenValues,
  });
  if (!gated.ok) return { status: "rejected", reason: gated.reason, detail: gated.detail };

  const mustVisit = new Set(context.baseline.must_visit.map(normalizePlaceName));
  const roles = ensureZoneBackups(
    gated.output.zones.map((z) => ({ items: z.items.map((i) => i.item_id) })),
    context.candidates.map((c) => ({
      id: c.id,
      candidate_role: c.candidate_role,
      total: c.total,
      protected: [c.name_zh, c.name_local].some((n) => n !== null && mustVisit.has(normalizePlaceName(n))),
    })),
  );
  await deps.applyZoning(run.jobId, { zones: gated.output.zones, roles });
  return { status: "stored", zones: gated.output.zones.length, backups: roles.length };
}
