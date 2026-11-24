// T31：旅前自動再核實的背景 job（由排程端點 /api/cron/reverify 啟動）。
// job 發起人為行程 Owner，每個 step 只以 job 編號重新讀取資料，只解密 Owner 的 key（C-12）。
// 已排入行程的項目每 10 個一批以 Verification 重新核對；資料可能已變動的項目標示 At Risk 並通知成員（SH-06）。

export interface ReverifyJobInput {
  jobId: string;
}

async function targets(jobId: string): Promise<string[][]> {
  "use step";
  const { reverifyTargets } = await import("../lib/server/research-runtime");
  return reverifyTargets(jobId);
}

async function reverifyChunk(jobId: string, itemIds: string[]): Promise<{ checked: number; flagged: number }> {
  "use step";
  const [{ roleSpec }, { runReverifyChunk }, { reverifyChunkDeps }] = await Promise.all([
    import("@atps/ai"),
    import("../lib/server/reverify-core"),
    import("../lib/server/research-runtime"),
  ]);
  return runReverifyChunk(reverifyChunkDeps(jobId), { jobId, itemIds, role: roleSpec("verification") });
}

async function finish(jobId: string, status: "completed" | "failed") {
  "use step";
  const { setReverifyJobStatus } = await import("../lib/server/research-runtime");
  await setReverifyJobStatus(jobId, status);
}

export async function reverifyJob(input: ReverifyJobInput): Promise<{ checked: number; flagged: number }> {
  "use workflow";
  let checked = 0;
  let flagged = 0;
  const chunks = await targets(input.jobId);
  for (const chunk of chunks) {
    const result = await reverifyChunk(input.jobId, chunk);
    checked += result.checked;
    flagged += result.flagged;
  }
  await finish(input.jobId, chunks.length > 0 && checked === 0 ? "failed" : "completed");
  return { checked, flagged };
}
