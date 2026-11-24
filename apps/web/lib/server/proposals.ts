import "server-only";
import type { Proposal } from "@atps/core";
import { SupabaseChangeWriter, SupabaseItineraryRepository } from "@atps/db";
import { changePayload, uuid } from "@atps/schemas";
import { createLogger } from "@atps/security";
import type { ProposalsDeps } from "./proposals-core";
import { createSupabaseServerClient, supabaseGuardDeps } from "./supabase";

// T34：提案與 Change Log。全部以使用者本人的 session 讀寫（RLS）；批准、否決經資料庫函式，批准者取自 session

export async function proposalsActionDeps(): Promise<ProposalsDeps> {
  const guard = await supabaseGuardDeps();
  const session = await createSupabaseServerClient();
  return {
    getUser: guard.getUser,
    checkRateLimit: guard.checkRateLimit,
    async loadProposal(id) {
      const { data } = await session.from("proposals").select("*").eq("id", id).maybeSingle();
      return (data as Proposal | null) ?? null;
    },
    async canDecide(tripId) {
      const { data: auth } = await session.auth.getUser();
      if (!auth.user) return false;
      const { data } = await session.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", auth.user.id).maybeSingle();
      return data?.role === "owner" || data?.role === "companion";
    },
    applyDeps: { writer: new SupabaseChangeWriter(session), itinerary: new SupabaseItineraryRepository(session) },
    logError: (message) => createLogger().error(message),
  };
}

const ROLE_LABELS: Record<string, string> = {
  research: "Research",
  verification: "Verification",
  transport: "Transport",
  master_planner: "Master Planner",
  live_planner: "Live Planner",
};

export interface ProposalView {
  id: string;
  status: "pending" | "applied" | "rejected" | "invalidated";
  summary: string;
  proposer: string;
  baseVersion: number;
  createdAt: string;
}

export interface ChangeLogView {
  version: string;
  summary: string;
  kind: "major" | "minor";
  proposer: string;
  approver: string;
  createdAt: string;
}

export type ProposalsView =
  | { state: "signed_out" }
  | { state: "not_found" }
  | {
      state: "ok";
      userId: string;
      tripName: string;
      currentVersion: number;
      canDecide: boolean;
      // 最近的提案（含已處理），依提出時間排列，處理後仍留在原位置
      proposals: ProposalView[];
      changeLog: ChangeLogView[];
    };

export async function loadProposals(tripId: string): Promise<ProposalsView> {
  const session = await createSupabaseServerClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return { state: "signed_out" };
  if (!uuid.safeParse(tripId).success) return { state: "not_found" };
  const { data: trip } = await session.from("trips").select("name, current_version").eq("id", tripId).maybeSingle();
  if (!trip) return { state: "not_found" };
  const { data: member } = await session.from("trip_members").select("role").eq("trip_id", tripId).eq("user_id", auth.user.id).maybeSingle();

  const { data: proposals } = await session
    .from("proposals")
    .select("id, change, base_version, status, proposer_member_id, proposer_role, proposer_provider, proposer_model, created_at")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })
    .limit(100);
  const { data: versions } = await session
    .from("versions")
    .select("major, minor, kind, summary, proposal_id, approved_by, created_at")
    .eq("trip_id", tripId)
    .order("major", { ascending: false })
    .order("minor", { ascending: false })
    .limit(30);

  const people = new Set<string>();
  for (const p of proposals ?? []) if (p.proposer_member_id) people.add(String(p.proposer_member_id));
  for (const v of versions ?? []) if (v.approved_by) people.add(String(v.approved_by));
  const { data: profiles } = people.size > 0 ? await session.from("profiles").select("id, display_name").in("id", [...people]) : { data: [] };
  const nameOf = (id: unknown) => String((profiles ?? []).find((p) => p.id === id)?.display_name ?? "成員");
  const proposerOf = (p: Record<string, unknown> | undefined): string => {
    if (!p) return "成員";
    if (p.proposer_member_id) return nameOf(p.proposer_member_id);
    const role = ROLE_LABELS[String(p.proposer_role)] ?? "AI";
    return p.proposer_model ? `${role}（${String(p.proposer_provider)} ${String(p.proposer_model)}）` : role;
  };
  const summaryOf = (change: unknown) => {
    const parsed = changePayload.safeParse(change);
    return parsed.success ? parsed.data.summary : "（內容格式不正確）";
  };

  return {
    state: "ok",
    userId: auth.user.id,
    tripName: String(trip.name),
    currentVersion: Number(trip.current_version),
    canDecide: member?.role === "owner" || member?.role === "companion",
    proposals: (proposals ?? []).slice(0, 30).map((p) => ({
        id: String(p.id),
        status: p.status as ProposalView["status"],
        summary: summaryOf(p.change),
        proposer: proposerOf(p as Record<string, unknown>),
        baseVersion: Number(p.base_version),
        createdAt: String(p.created_at),
      })),
    changeLog: (versions ?? []).map((v) => ({
      version: `v${String(v.major)}.${String(v.minor)}`,
      summary: String(v.summary),
      kind: v.kind === "major" ? "major" : "minor",
      proposer: v.proposal_id ? proposerOf((proposals ?? []).find((p) => p.id === v.proposal_id) as Record<string, unknown> | undefined) : "成員",
      approver: v.approved_by ? nameOf(v.approved_by) : "自動套用",
      createdAt: String(v.created_at),
    })),
  };
}
