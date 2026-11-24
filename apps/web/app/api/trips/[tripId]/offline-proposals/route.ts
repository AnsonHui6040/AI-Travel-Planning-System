import type { ChangePayload } from "@atps/schemas";
import { createLogger } from "@atps/security";
import { guardRequest } from "../../../../../lib/server/guard";
import { syncOfflineChange } from "../../../../../lib/server/offline-sync-core";
import { createSupabaseServerClient, supabaseGuardDeps } from "../../../../../lib/server/supabase";

// T35（SH-05）：離線修改佇列的同步端點。Origin、登入、速率限制由 guardRequest 檢查（C-11）；
// 以使用者本人的 session 建立待批准提案（RLS：只有 Owner、Companion 可以提出）

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const guard = await guardRequest(request, { endpoint: "offline.sync", limit: 60, windowSeconds: 60, ...(await supabaseGuardDeps()) });
  if (!guard.ok) return guard.response;
  const { tripId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "修改內容不正確" }, { status: 400 });
  }
  const session = await createSupabaseServerClient();
  try {
    const result = await syncOfflineChange(
      {
        async canEdit(id) {
          const { data } = await session.from("trip_members").select("role").eq("trip_id", id).eq("user_id", guard.user.id).maybeSingle();
          return data?.role === "owner" || data?.role === "companion";
        },
        async loadItem(id, itemId) {
          const { data } = await session.from("itinerary_items").select("name_zh, scheduled_date").eq("trip_id", id).eq("id", itemId).maybeSingle();
          return data ? { name_zh: String(data.name_zh), scheduled_date: (data.scheduled_date as string | null) ?? null } : null;
        },
        async createProposal(input: { tripId: string; memberId: string; baseVersion: number; change: ChangePayload; impactScope: { dates: string[] } }) {
          const { error } = await session.from("proposals").insert({
            trip_id: input.tripId,
            proposer_member_id: input.memberId,
            base_version: input.baseVersion,
            change: input.change,
            impact_scope: input.impactScope,
          });
          if (error) throw new Error("建立提案失敗");
        },
      },
      { userId: guard.user.id, tripId, body },
    );
    return Response.json({ message: result.message }, { status: result.status });
  } catch {
    createLogger().error("同步離線修改失敗");
    return Response.json({ error: "同步失敗" }, { status: 500 });
  }
}
