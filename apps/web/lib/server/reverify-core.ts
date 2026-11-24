import { createHash, timingSafeEqual } from "node:crypto";
import {
  dueReverification,
  reverifyAtRisk,
  type ModelRef,
  type ReverifyItem,
  type ReverifyKind,
  type ReverifyResult,
  type ReverifyTrip,
  type RoleSpec,
} from "@atps/core";
import type { ChangePayload } from "@atps/schemas";
import { runVerificationChunk, type VerificationDeps } from "./verification-core";

// T31：旅前自動再核實（D25、C-12、SH-06）。
// 排程端點（Vercel Cron）以 CRON_SECRET 驗證，每天執行一次：以目的地時區判斷 T-7、T-1，
// 只對 Owner 已開啟排程的行程經 start_reverification 建立 job（發起人為 Owner，只解密 Owner 的 key）。
// 背景 step 以 Verification 重新核對已排入行程的項目；核實結果不寫回行程，
// 資料可能已變動的項目以 approved_fact_invalidated 提案標示 At Risk（自動套用並通知成員）。

const MIN_SECRET_LENGTH = 16;
const digest = (value: string) => createHash("sha256").update(value).digest();

export function authorizeCron(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < MIN_SECRET_LENGTH || !header) return false;
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

export interface ReverifyCronTrip extends ReverifyTrip {
  id: string;
  ran: ReverifyKind[];
}

export interface ReverifyCronDeps {
  // 已開啟排程的行程（含已執行的種類）
  listTrips: () => Promise<ReverifyCronTrip[]>;
  // start_reverification：未開啟或已執行時回傳 null
  start: (tripId: string, kind: ReverifyKind) => Promise<string | null>;
  launch: (jobId: string) => Promise<void>;
}

export async function runReverifyCron(deps: ReverifyCronDeps, now: Date): Promise<Array<{ tripId: string; kind: ReverifyKind; jobId: string }>> {
  const started: Array<{ tripId: string; kind: ReverifyKind; jobId: string }> = [];
  for (const trip of await deps.listTrips()) {
    const kind = dueReverification(trip, trip.ran, now);
    if (!kind) continue;
    const jobId = await deps.start(trip.id, kind);
    if (!jobId) continue;
    await deps.launch(jobId);
    started.push({ tripId: trip.id, kind, jobId });
  }
  return started;
}

export interface ReverifyChunkDeps extends Omit<VerificationDeps, "applyVerification"> {
  // 本批中已排入行程的項目
  loadScheduled: (jobId: string, itemIds: readonly string[]) => Promise<ReverifyItem[]>;
  submitAtRisk: (jobId: string, change: ChangePayload, by: ModelRef) => Promise<void>;
}

export interface ReverifyChunkRun {
  jobId: string;
  itemIds: string[];
  role: RoleSpec;
}

export async function runReverifyChunk(deps: ReverifyChunkDeps, run: ReverifyChunkRun): Promise<{ checked: number; flagged: number }> {
  const results: ReverifyResult[] = [];
  let by: ModelRef | null = null;
  await runVerificationChunk(
    {
      ...deps,
      // 再核實不改動行程的核實狀態，只收集交叉核查後的結果
      applyVerification: async (_job, write) => {
        results.push({ item_id: write.itemId, status: write.status, availability: write.availability });
        by = write.verifiedBy;
      },
    },
    run,
  );
  if (results.length === 0 || !by) return { checked: 0, flagged: 0 };
  const change = reverifyAtRisk(await deps.loadScheduled(run.jobId, run.itemIds), results);
  if (change) await deps.submitAtRisk(run.jobId, change, by);
  return { checked: results.length, flagged: change?.operations.length ?? 0 };
}
