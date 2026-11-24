import "server-only";
import { uuid } from "@atps/schemas";
import { createLogger } from "@atps/security";
import { MembersStoreError, type InviteRole, type MembersDeps } from "./members-core";
import { createSupabaseServerClient, supabaseGuardDeps } from "./supabase";

// T32：成員管理以使用者本人的 session 執行。邀請經 create_trip_invitation、revoke_trip_invitation、
// accept_trip_invitation（擁有者 atps_member_manager）；角色變更與移除受 RLS 限制

function storeError(code: string | undefined): MembersStoreError {
  if (code === "42501") return new MembersStoreError("forbidden");
  if (code === "22023" || code === "54000") return new MembersStoreError("invalid");
  return new MembersStoreError("unknown");
}

export async function membersActionDeps(): Promise<MembersDeps> {
  const guard = await supabaseGuardDeps();
  const session = await createSupabaseServerClient();
  return {
    getUser: guard.getUser,
    checkRateLimit: guard.checkRateLimit,
    siteUrl: process.env.SITE_URL ?? "",
    async createInvite(tripId, role) {
      const { data, error } = await session.rpc("create_trip_invitation", { p_trip: tripId, p_role: role });
      if (error || typeof data !== "string") throw storeError(error?.code);
      return data;
    },
    async revokeInvite(id) {
      const { error } = await session.rpc("revoke_trip_invitation", { p_invitation: id });
      if (error) throw storeError(error.code);
    },
    async acceptInvite(token) {
      const { data, error } = await session.rpc("accept_trip_invitation", { p_token: token });
      if (error || typeof data !== "string") throw storeError(error?.code);
      return data;
    },
    async changeRole(tripId, userId, role) {
      const { data, error } = await session.from("trip_members").update({ role }).eq("trip_id", tripId).eq("user_id", userId).select("user_id");
      if (error) throw storeError(error.code);
      return data.length;
    },
    async removeMember(tripId, userId) {
      const { data, error } = await session.from("trip_members").delete().eq("trip_id", tripId).eq("user_id", userId).select("user_id");
      if (error) throw storeError(error.code);
      return data.length;
    },
    async createReadonlyLink(tripId, days) {
      const { data, error } = await session.rpc("create_readonly_link", { p_trip: tripId, p_days: days });
      if (error || typeof data !== "string") throw storeError(error?.code);
      return data;
    },
    async revokeReadonlyLink(id) {
      const { error } = await session.rpc("revoke_readonly_link", { p_link: id });
      if (error) throw storeError(error.code);
    },
    logError: (message) => createLogger().error(message),
  };
}

export type MemberRole = InviteRole | "owner";

export type MembersView =
  | { state: "signed_out" }
  | { state: "not_found" }
  | {
      state: "ok";
      tripName: string;
      myRole: MemberRole;
      members: Array<{ userId: string; name: string; role: MemberRole; isMe: boolean }>;
      invitations: Array<{ id: string; role: InviteRole; expiresAt: string; status: "active" | "accepted" | "revoked" | "expired" }>;
      // T33：只有 Owner 看得到
      readonlyLinks: Array<{ id: string; expiresAt: string; status: "active" | "revoked" | "expired" }>;
    };

export async function loadMembers(tripId: string): Promise<MembersView> {
  const session = await createSupabaseServerClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return { state: "signed_out" };
  if (!uuid.safeParse(tripId).success) return { state: "not_found" };
  const { data: trip } = await session.from("trips").select("name").eq("id", tripId).maybeSingle();
  if (!trip) return { state: "not_found" };
  const { data: rows, error } = await session.from("trip_members").select("user_id, role, joined_at").eq("trip_id", tripId).order("joined_at").limit(100);
  if (error) throw new Error("讀取成員失敗");
  const ids = (rows ?? []).map((r) => String(r.user_id));
  const { data: profiles } = await session.from("profiles").select("id, display_name").in("id", ids);
  const me = auth.user.id;
  const myRole = ((rows ?? []).find((r) => r.user_id === me)?.role ?? "viewer") as MemberRole;
  const members = (rows ?? []).map((r) => ({
    userId: String(r.user_id),
    name: String((profiles ?? []).find((p) => p.id === r.user_id)?.display_name ?? "未設定名稱的成員"),
    role: r.role as MemberRole,
    isMe: r.user_id === me,
  }));
  let invitations: Extract<MembersView, { state: "ok" }>["invitations"] = [];
  if (myRole === "owner") {
    const { data: inv } = await session
      .from("trip_invitations")
      .select("id, role, expires_at, accepted_at, revoked_at")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false })
      .limit(20);
    const now = Date.now();
    invitations = (inv ?? []).map((i) => ({
      id: String(i.id),
      role: i.role as InviteRole,
      expiresAt: String(i.expires_at),
      status: i.accepted_at ? "accepted" : i.revoked_at ? "revoked" : Date.parse(String(i.expires_at)) <= now ? "expired" : "active",
    }));
  }
  let readonlyLinks: Extract<MembersView, { state: "ok" }>["readonlyLinks"] = [];
  if (myRole === "owner") {
    const { data: links } = await session
      .from("readonly_links")
      .select("id, expires_at, revoked_at")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false })
      .limit(20);
    const now = Date.now();
    readonlyLinks = (links ?? []).map((l) => ({
      id: String(l.id),
      expiresAt: String(l.expires_at),
      status: l.revoked_at ? "revoked" : Date.parse(String(l.expires_at)) <= now ? "expired" : "active",
    }));
  }
  return { state: "ok", tripName: String(trip.name), myRole, members, invitations, readonlyLinks };
}

export type InvitePreview = { state: "signed_out" } | { state: "invalid" } | { state: "member" | "valid"; tripName: string; role: InviteRole };

export async function loadInvitePreview(token: string): Promise<InvitePreview> {
  const session = await createSupabaseServerClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return { state: "signed_out" };
  if (!/^[0-9a-f]{64}$/.test(token)) return { state: "invalid" };
  const { data, error } = await session.rpc("invitation_preview", { p_token: token });
  const row = (Array.isArray(data) ? data[0] : null) as { trip_name: string | null; role: string | null; status: string } | null;
  if (error || !row || row.status === "invalid" || !row.trip_name) return { state: "invalid" };
  return { state: row.status === "member" ? "member" : "valid", tripName: row.trip_name, role: row.role === "companion" ? "companion" : "viewer" };
}
