import "server-only";
import { createLogger } from "@atps/security";
import { DayApprovalStoreError, type DayApprovalDeps } from "./day-approval-core";
import { loadDayPlan } from "./day-draft";
import { createSupabaseServerClient, supabaseGuardDeps } from "./supabase";

// T30：批准一天以使用者本人的 session 呼叫 approve_day（以 atps_change_writer 身分執行）

function storeError(code: string | undefined): DayApprovalStoreError {
  if (code === "42501") return new DayApprovalStoreError("forbidden");
  if (code === "55000") return new DayApprovalStoreError("state");
  if (code === "22023") return new DayApprovalStoreError("invalid");
  return new DayApprovalStoreError("unknown");
}

export async function dayApprovalDeps(): Promise<DayApprovalDeps> {
  const guard = await supabaseGuardDeps();
  const session = await createSupabaseServerClient();
  return {
    getUser: guard.getUser,
    checkRateLimit: guard.checkRateLimit,
    loadPlan: loadDayPlan,
    async approve(tripId, date, entries, baseVersion) {
      const { data, error } = await session.rpc("approve_day", { p_trip: tripId, p_date: date, p_entries: entries, p_base_version: baseVersion });
      if (error) throw storeError(error.code);
      const result = (data ?? {}) as { outcome?: string; locked?: boolean };
      return { outcome: result.outcome === "approved" ? "approved" : "invalidated", locked: result.locked === true };
    },
    logError: (message) => createLogger().error(message),
  };
}
