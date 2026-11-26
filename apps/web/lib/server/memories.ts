import "server-only";
import { mergeMemories, type MemoryEntry, type MergedMemory } from "@atps/memory";
import { uuid } from "@atps/schemas";
import { createLogger } from "@atps/security";
import { MemoryStoreError, type MemoryDeps } from "./memories-core";
import { loadPostTrip } from "./post-trip";
import { createSupabaseServerClient, supabaseGuardDeps } from "./supabase";

// T41：記憶一律以使用者本人的 session 讀寫（RLS own_all）；共同行程的合併經 trip_memories（不含來源成員）

function storeError(code: string | undefined): MemoryStoreError {
  if (code === "42501") return new MemoryStoreError("forbidden");
  if (code === "55000") return new MemoryStoreError("state");
  if (code === "22023" || code === "23514") return new MemoryStoreError("invalid");
  return new MemoryStoreError("unknown");
}

export async function memoryDeps(): Promise<MemoryDeps> {
  const guard = await supabaseGuardDeps();
  const session = await createSupabaseServerClient();
  return {
    getUser: guard.getUser,
    checkRateLimit: guard.checkRateLimit,
    async isTripMember(tripId) {
      const { data } = await session.from("trips").select("id").eq("id", tripId).maybeSingle();
      return Boolean(data);
    },
    async save(row) {
      const { data: auth } = await session.auth.getUser();
      if (!auth.user) throw new MemoryStoreError("forbidden");
      const result = row.id
        ? await session.from("memories").update({ value: row.value, unit: row.unit }).eq("id", row.id).eq("owner_id", auth.user.id)
        : await session.from("memories").insert({
            owner_id: auth.user.id,
            layer: row.layer,
            trip_id: row.tripId,
            kind: row.kind,
            item: row.item,
            value: row.value,
            unit: row.unit,
            source: "manual",
          });
      if (result.error) throw storeError(result.error.code);
    },
    async remove(id) {
      const { error } = await session.from("memories").delete().eq("id", id);
      if (error) throw storeError(error.code);
    },
    async decide(proposalId, approve) {
      const { error } = await session.rpc("decide_memory_proposal", { p_proposal: proposalId, p_approve: approve });
      if (error) throw storeError(error.code);
    },
    async loadPostTrip(tripId) {
      const view = await loadPostTrip(tripId);
      return view.state === "ok" ? { tripStatus: view.tripStatus, report: view.report } : null;
    },
    async createProposals(tripId, drafts) {
      const { data, error } = await session.rpc("create_post_trip_memory_proposals", { p_trip: tripId, p_items: drafts });
      if (error) throw storeError(error.code);
      return Number(data ?? 0);
    },
    logError: (message) => createLogger().error(message),
  };
}

export interface OwnMemory {
  id: string;
  layer: MemoryEntry["layer"];
  kind: MemoryEntry["kind"];
  item: string;
  value: string;
  unit: string | null;
  tripId: string | null;
  tripName: string | null;
  source: string;
}

export interface PendingProposal {
  id: string;
  tripName: string;
  item: string;
  value: string;
  unit: string | null;
  reason: string;
}

export async function loadOwnMemories(): Promise<{ signedIn: boolean; memories: OwnMemory[]; proposals: PendingProposal[] }> {
  const session = await createSupabaseServerClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return { signedIn: false, memories: [], proposals: [] };
  const { data: rows } = await session
    .from("memories")
    .select("id, layer, kind, item, value, unit, trip_id, source")
    .eq("owner_id", auth.user.id)
    .order("created_at")
    .limit(500);
  const { data: pending } = await session
    .from("memory_proposals")
    .select("id, trip_id, item, value, unit, reason")
    .eq("owner_id", auth.user.id)
    .eq("status", "pending")
    .order("created_at")
    .limit(50);
  const tripIds = [...new Set([...(rows ?? []).map((r) => r.trip_id), ...(pending ?? []).map((p) => p.trip_id)].filter((t): t is string => typeof t === "string"))];
  const { data: trips } = tripIds.length > 0 ? await session.from("trips").select("id, name").in("id", tripIds) : { data: [] };
  const names = new Map((trips ?? []).map((t) => [String(t.id), String(t.name)]));
  return {
    signedIn: true,
    memories: (rows ?? []).map((r) => ({
      id: String(r.id),
      layer: r.layer as OwnMemory["layer"],
      kind: r.kind as OwnMemory["kind"],
      item: String(r.item),
      value: String(r.value),
      unit: (r.unit as string | null) ?? null,
      tripId: (r.trip_id as string | null) ?? null,
      tripName: r.trip_id ? (names.get(String(r.trip_id)) ?? "已不在的行程") : null,
      source: String(r.source),
    })),
    proposals: (pending ?? []).map((p) => ({
      id: String(p.id),
      tripName: names.get(String(p.trip_id)) ?? "行程",
      item: String(p.item),
      value: String(p.value),
      unit: (p.unit as string | null) ?? null,
      reason: String(p.reason),
    })),
  };
}

export type TripMemoryView =
  | { state: "signed_out" }
  | { state: "not_found" }
  | { state: "ok"; tripName: string; merged: MergedMemory[]; own: OwnMemory[] };

// MEM-07、MEM-08：共同行程合併所有成員的記憶，衝突標示但不顯示來源成員
export async function loadTripMemories(tripId: string): Promise<TripMemoryView> {
  const session = await createSupabaseServerClient();
  const { data: auth } = await session.auth.getUser();
  if (!auth.user) return { state: "signed_out" };
  if (!uuid.safeParse(tripId).success) return { state: "not_found" };
  const { data: trip } = await session.from("trips").select("name").eq("id", tripId).maybeSingle();
  if (!trip) return { state: "not_found" };
  const { data: rows, error } = await session.rpc("trip_memories", { p_trip: tripId });
  if (error) return { state: "not_found" };
  const entries: MemoryEntry[] = ((rows ?? []) as Array<Record<string, unknown>>).map((r) => ({
    layer: r.layer as MemoryEntry["layer"],
    kind: r.kind as MemoryEntry["kind"],
    item: String(r.item),
    value: String(r.value),
    unit: (r.unit as string | null) ?? null,
  }));
  const { data: own } = await session
    .from("memories")
    .select("id, layer, kind, item, value, unit, trip_id, source")
    .eq("owner_id", auth.user.id)
    .eq("trip_id", tripId)
    .order("created_at")
    .limit(100);
  return {
    state: "ok",
    tripName: String(trip.name),
    merged: mergeMemories(entries),
    own: (own ?? []).map((r) => ({
      id: String(r.id),
      layer: r.layer as OwnMemory["layer"],
      kind: r.kind as OwnMemory["kind"],
      item: String(r.item),
      value: String(r.value),
      unit: (r.unit as string | null) ?? null,
      tripId,
      tripName: String(trip.name),
      source: String(r.source),
    })),
  };
}
