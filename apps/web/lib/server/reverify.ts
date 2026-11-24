import "server-only";
import { REVERIFY_KINDS, type ReverifyKind } from "@atps/core";
import { start } from "workflow/api";
import { reverifyJob } from "../../workflows/reverify-job";
import type { ReverifyCronDeps } from "./reverify-core";
import { createSupabaseServiceClient } from "./supabase";

// T31：排程端點的 Supabase 連接。只列出 Owner 已開啟排程的行程；job 只經 start_reverification 建立

export function reverifyCronDeps(): ReverifyCronDeps {
  const service = createSupabaseServiceClient();
  return {
    async listTrips() {
      const { data: trips, error } = await service
        .from("trips")
        .select("id, start_date, timezone, status, reverify_enabled")
        .eq("reverify_enabled", true)
        .in("status", ["planning", "locked"])
        .not("start_date", "is", null)
        .limit(500);
      if (error) throw new Error("讀取行程失敗");
      const ids = (trips ?? []).map((t) => String(t.id));
      if (ids.length === 0) return [];
      const { data: runs, error: runsError } = await service.from("reverify_runs").select("trip_id, kind").in("trip_id", ids);
      if (runsError) throw new Error("讀取再核實紀錄失敗");
      return (trips ?? []).map((t) => ({
        id: String(t.id),
        start_date: String(t.start_date),
        timezone: String(t.timezone),
        status: t.status as "planning" | "locked",
        reverify_enabled: t.reverify_enabled === true,
        ran: (runs ?? [])
          .filter((r) => String(r.trip_id) === String(t.id))
          .map((r) => r.kind as ReverifyKind)
          .filter((k) => REVERIFY_KINDS.includes(k)),
      }));
    },
    async start(tripId, kind) {
      const { data, error } = await service.rpc("start_reverification", { p_trip: tripId, p_kind: kind });
      if (error) throw new Error("建立再核實 job 失敗");
      return typeof data === "string" ? data : null;
    },
    async launch(jobId) {
      const run = await start(reverifyJob, [{ jobId }]);
      const { error } = await service.from("background_jobs").update({ workflow_run_id: run.runId }).eq("id", jobId);
      if (error) throw new Error("記錄再核實 job 失敗");
    },
  };
}
