import { RESEARCH_TRACK_IDS, type ResearchTrackId } from "@atps/core";

// T24：多 AI 獨立研究的背景 job。Research A–D 各為一個 step 平行執行，彼此不交換結果；
// 每個 step 只以 job 編號重新讀取行程與基線，只解密 job 發起人的 key（C-12）。
// step 重試時候選不會重複寫入（add_research_candidates 以 job 與方向判斷）。
// 伺服器模組在 step 內載入：workflow 本體不直接使用資料庫或網路。

export interface ResearchJobInput {
  jobId: string;
}

export interface TrackSummary {
  track: ResearchTrackId;
  status: "stored" | "rejected" | "not_completed";
  count: number;
  detail: string | null;
}

async function setStatus(jobId: string, status: "running" | "completed" | "failed") {
  "use step";
  const { setResearchJobStatus } = await import("../lib/server/research-runtime");
  await setResearchJobStatus(jobId, status);
}

async function researchTrack(jobId: string, track: ResearchTrackId): Promise<TrackSummary> {
  "use step";
  const [{ roleSpec }, { runResearchTrack }, { researchTrackDeps }] = await Promise.all([
    import("@atps/ai"),
    import("../lib/server/research-core"),
    import("../lib/server/research-runtime"),
  ]);
  const result = await runResearchTrack(researchTrackDeps(jobId), { jobId, track, role: roleSpec("research") });
  if (result.status === "stored") return { track, status: "stored", count: result.count, detail: null };
  if (result.status === "rejected") return { track, status: "rejected", count: 0, detail: result.reason };
  return { track, status: "not_completed", count: 0, detail: result.run.status };
}

export async function researchJob(input: ResearchJobInput): Promise<TrackSummary[]> {
  "use workflow";
  await setStatus(input.jobId, "running");
  const results = await Promise.all(RESEARCH_TRACK_IDS.map((track) => researchTrack(input.jobId, track)));
  await setStatus(input.jobId, results.some((r) => r.status === "stored") ? "completed" : "failed");
  return results;
}
