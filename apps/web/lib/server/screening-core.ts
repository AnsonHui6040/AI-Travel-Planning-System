import { screenCandidates, type ScreeningItem, type ScreeningResult } from "@atps/core";
import type { TripBaselineData } from "@atps/schemas";

// T26：研究 job 的候選篩選。以已確認的基線為所有尚未排入行程的候選評分，結果一次寫入。

export interface ScreeningDeps {
  // job 所屬行程已確認的基線；沒有時為 null
  loadBaseline: (jobId: string) => Promise<TripBaselineData | null>;
  listCandidates: (jobId: string) => Promise<ScreeningItem[]>;
  applyScores: (jobId: string, results: ScreeningResult[]) => Promise<number>;
}

export async function screenJobCandidates(deps: ScreeningDeps, jobId: string): Promise<number> {
  const baseline = await deps.loadBaseline(jobId);
  if (!baseline) return 0;
  const candidates = await deps.listCandidates(jobId);
  if (candidates.length === 0) return 0;
  return deps.applyScores(jobId, screenCandidates(candidates, { baseline }));
}
