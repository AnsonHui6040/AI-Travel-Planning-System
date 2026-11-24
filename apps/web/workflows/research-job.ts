import { RESEARCH_TRACK_IDS, type ResearchTrackId } from "@atps/core";

// T24：多 AI 獨立研究的背景 job。Research A–D 各為一個 step 平行執行，彼此不交換結果；
// 每個 step 只以 job 編號重新讀取行程與基線，只解密 job 發起人的 key（C-12）。
// step 重試時候選不會重複寫入（add_research_candidates 以 job 與方向判斷）。
// T25：研究完成後合併重複候選，再由 Verification 逐批交叉核查（每批一個 step）。
// T26：以八個維度為所有候選評分，標記 Primary 與 Backup。
// T27：依交通把候選分區（以 Transport 的模型設定），每個主要區域至少一個 Backup。
// T28：最後由 Transport 估算各分區內相鄰候選之間的交通（每批一個 step）。
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

async function dedupe(jobId: string): Promise<number> {
  "use step";
  const [{ dedupeCandidates }, { dedupeDeps }] = await Promise.all([
    import("../lib/server/verification-core"),
    import("../lib/server/research-runtime"),
  ]);
  return dedupeCandidates(dedupeDeps(), jobId);
}

async function verificationChunks(jobId: string): Promise<string[][]> {
  "use step";
  const { verificationTargets } = await import("../lib/server/research-runtime");
  return verificationTargets(jobId);
}

async function verifyChunk(jobId: string, itemIds: string[]): Promise<{ status: string; count: number }> {
  "use step";
  const [{ roleSpec }, { runVerificationChunk }, { verificationDeps }] = await Promise.all([
    import("@atps/ai"),
    import("../lib/server/verification-core"),
    import("../lib/server/research-runtime"),
  ]);
  const result = await runVerificationChunk(verificationDeps(jobId), { jobId, itemIds, role: roleSpec("verification") });
  return { status: result.status, count: result.status === "stored" ? result.count : 0 };
}

async function screen(jobId: string): Promise<number> {
  "use step";
  const [{ screenJobCandidates }, { screeningDeps }] = await Promise.all([
    import("../lib/server/screening-core"),
    import("../lib/server/research-runtime"),
  ]);
  return screenJobCandidates(screeningDeps(), jobId);
}

async function zoning(jobId: string): Promise<string> {
  "use step";
  const [{ zoningSpec }, { runZoning }, { zoningDeps }] = await Promise.all([
    import("@atps/ai"),
    import("../lib/server/zoning-core"),
    import("../lib/server/research-runtime"),
  ]);
  return (await runZoning(zoningDeps(jobId), { jobId, spec: zoningSpec() })).status;
}

async function transportChunks(jobId: string): Promise<{ from: string; to: string }[][]> {
  "use step";
  const { transportPairChunks } = await import("../lib/server/research-runtime");
  return transportPairChunks(jobId);
}

async function estimateSegments(jobId: string, pairs: { from: string; to: string }[]): Promise<number> {
  "use step";
  const [{ roleSpec }, { runTransportSegments }, { transportDeps }] = await Promise.all([
    import("@atps/ai"),
    import("../lib/server/transport-core"),
    import("../lib/server/research-runtime"),
  ]);
  const result = await runTransportSegments(transportDeps(jobId), { jobId, pairs, role: roleSpec("transport") });
  return result.status === "stored" ? result.count : 0;
}

export interface ResearchJobResult {
  tracks: TrackSummary[];
  merged: number;
  verified: number;
  screened: number;
  zoning: string;
  segments: number;
}

export async function researchJob(input: ResearchJobInput): Promise<ResearchJobResult> {
  "use workflow";
  await setStatus(input.jobId, "running");
  const tracks = await Promise.all(RESEARCH_TRACK_IDS.map((track) => researchTrack(input.jobId, track)));
  const merged = await dedupe(input.jobId);
  let verified = 0;
  for (const chunk of await verificationChunks(input.jobId)) {
    verified += (await verifyChunk(input.jobId, chunk)).count;
  }
  const screened = await screen(input.jobId);
  const zoned = await zoning(input.jobId);
  let segments = 0;
  for (const chunk of await transportChunks(input.jobId)) {
    segments += await estimateSegments(input.jobId, chunk);
  }
  await setStatus(input.jobId, tracks.some((r) => r.status === "stored") ? "completed" : "failed");
  return { tracks, merged, verified, screened, zoning: zoned, segments };
}
