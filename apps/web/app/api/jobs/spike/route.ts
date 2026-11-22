import { start } from "workflow/api";
import { guardRequest } from "../../../../lib/server/guard";
import { supabaseGuardDeps } from "../../../../lib/server/supabase";
import { spikeLongJob } from "../../../../workflows/spike-long-job";

// T05 技術 spike：啟動示範長時間 job。預設關閉，只有設定 ENABLE_SPIKE_JOBS=1 時可用。
// 發起人編號取自登入者（C-12）；查詢與取消 job 的端點於建立背景 job 資料表（T06）後加入。
export async function POST(request: Request) {
  if (process.env.ENABLE_SPIKE_JOBS !== "1") {
    return Response.json({ error: "找不到" }, { status: 404 });
  }
  const guard = await guardRequest(request, {
    endpoint: "jobs.spike.start",
    limit: 5,
    windowSeconds: 60,
    ...(await supabaseGuardDeps()),
  });
  if (!guard.ok) return guard.response;

  const run = await start(spikeLongJob, [{ initiatorId: guard.user.id, totalChunks: 3 }]);
  return Response.json({ runId: run.runId }, { status: 202 });
}
