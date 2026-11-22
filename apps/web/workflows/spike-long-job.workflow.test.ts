import { waitForSleep } from "@workflow/vitest";
import { getRun, start } from "workflow/api";
import { describe, expect, it } from "vitest";
import { spikeLongJob, type JobProgress } from "./spike-long-job";

type StartedRun = Awaited<ReturnType<typeof start<[Parameters<typeof spikeLongJob>[0]], Awaited<ReturnType<typeof spikeLongJob>>>>>;

async function readProgress(run: StartedRun): Promise<JobProgress[]> {
  const items: JobProgress[] = [];
  const reader = run.getReadable<JobProgress>().getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    items.push(value);
  }
  return items;
}

async function waitForStatus(run: StartedRun, expected: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let status = await run.status;
  while (status !== expected && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    status = await run.status;
  }
  return status;
}

// 讀取目前已寫入的進度；串流未關閉時，在一段時間沒有新資料後停止
async function readProgressUntilIdle(run: StartedRun, idleMs = 1_000): Promise<JobProgress[]> {
  const items: JobProgress[] = [];
  const reader = run.getReadable<JobProgress>().getReader();
  for (;;) {
    const next = await Promise.race([
      reader.read(),
      new Promise<null>((r) => setTimeout(() => r(null), idleMs)),
    ]);
    if (next === null || next.done) break;
    items.push(next.value);
  }
  await reader.cancel().catch(() => undefined);
  return items;
}

async function wakeSleeps(run: StartedRun, count: number) {
  for (let i = 0; i < count; i++) {
    const id = await waitForSleep(run);
    await getRun(run.runId).wakeUp({ correlationIds: [id] });
  }
}

const initiatorId = "00000000-0000-0000-0000-00000000000a";

describe("T05 Vercel Workflow 長時間 job", () => {
  it("完成所有步驟，逐步回報進度，並記錄發起人", async () => {
    const run = await start(spikeLongJob, [{ initiatorId, totalChunks: 3 }]);
    await wakeSleeps(run, 2);
    const result = await run.returnValue;
    expect(result.initiatorId).toBe(initiatorId);
    expect(result.chunks.map((c) => c.chunk)).toEqual([1, 2, 3]);
    expect(await run.status).toBe("completed");
    expect(await readProgress(run)).toEqual([
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ]);
  });

  it("暫時失敗自動重試，第 3 次嘗試成功", async () => {
    const run = await start(spikeLongJob, [
      { initiatorId, totalChunks: 1, transientFailures: { chunk: 1, times: 2 } },
    ]);
    const result = await run.returnValue;
    expect(result.chunks[0]?.attempt).toBe(3);
  });

  it("永久失敗不重試，run 狀態為 failed", async () => {
    const run = await start(spikeLongJob, [{ initiatorId, totalChunks: 2, fatalAtChunk: 1 }]);
    await expect(run.returnValue).rejects.toThrow();
    expect(await run.status).toBe("failed");
    expect(await readProgress(run)).toEqual([]);
  });

  it("取消後不再執行後續步驟，run 狀態為 cancelled", async () => {
    const run = await start(spikeLongJob, [{ initiatorId, totalChunks: 3 }]);
    await waitForSleep(run);
    await getRun(run.runId).cancel();
    expect(await waitForStatus(run, "cancelled")).toBe("cancelled");
    // 取消後 sleep 不再醒來，後續 chunk 不執行
    expect(await readProgressUntilIdle(run)).toEqual([{ done: 1, total: 3 }]);
  });
});
