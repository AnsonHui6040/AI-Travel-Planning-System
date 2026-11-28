import "server-only";
import { randomUUID } from "node:crypto";
import { FEASIBILITY_LABELS } from "@atps/core";
import { createLogger } from "@atps/security";
import { loadDayDraft } from "./day-draft";
import { EditStoreError, type EditContext, type EditDeps } from "./item-edit-core";
import { createSupabaseServerClient, supabaseGuardDeps } from "./supabase";

// 決策 0010 E、決策 0011：編輯以使用者本人的 session 呼叫資料庫函式（以 atps_item_editor 身分執行）或建立提案（RLS：Owner、Companion）

function storeError(code: string | undefined): EditStoreError {
  if (code === "42501") return new EditStoreError("forbidden");
  if (code === "55000") return new EditStoreError("state");
  if (code === "22023" || code === "23514" || code === "22P02") return new EditStoreError("invalid");
  return new EditStoreError("unknown");
}

export async function loadEditContext(tripId: string): Promise<EditContext | null> {
  const view = await loadDayDraft(tripId);
  if (view.state !== "ok") return null;
  return {
    tripStatus: view.tripStatus as EditContext["tripStatus"],
    baseVersion: view.baseVersion,
    canEdit: view.canEdit,
    role: view.isOwner ? "owner" : view.canEdit ? "companion" : null,
    manualSchedule: view.manualSchedule,
    dates: view.days.map((d) => d.date),
    days: view.days.map((d) => ({
      date: d.date,
      status: d.status,
      placements: d.entries.flatMap((e) => (e.kind === "item" ? [{ itemId: e.item_id, start: e.start, end: e.end }] : [])),
    })),
    items: Object.values(view.items).map((i) => ({ id: i.id, name_zh: i.nameZh, scheduled_date: i.scheduledDate, suggested_stay_minutes: i.stayMinutes })),
  };
}

export async function itemEditDeps(): Promise<EditDeps> {
  const guard = await supabaseGuardDeps();
  const session = await createSupabaseServerClient();
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await session.rpc(fn, args);
    if (error) throw storeError(error.code);
    return data as unknown;
  };
  return {
    getUser: guard.getUser,
    checkRateLimit: guard.checkRateLimit,
    load: loadEditContext,
    newId: () => randomUUID(),
    async addItem(tripId, item, slot, draft) {
      return String(await rpc("add_trip_item", { p_trip: tripId, p_item: item, p_slot: slot, p_draft: draft }));
    },
    async updateItem(itemId, fields) {
      await rpc("update_trip_item", { p_item: itemId, p_fields: fields });
    },
    async deleteItem(itemId) {
      await rpc("delete_trip_item", { p_item: itemId });
    },
    async scheduleItems(tripId, slots, draft) {
      await rpc("schedule_trip_items", { p_trip: tripId, p_slots: slots, p_draft: draft });
    },
    async propose(tripId, baseVersion, change, dates) {
      const user = await guard.getUser();
      const { error } = await session.from("proposals").insert({
        trip_id: tripId,
        proposer_member_id: user?.id,
        base_version: baseVersion,
        change,
        impact_scope: { dates },
      });
      if (error) throw storeError(error.code);
    },
    async applyOwner(tripId, baseVersion, change, dates) {
      const result = (await rpc("apply_owner_change", { p_trip: tripId, p_base_version: baseVersion, p_change: change, p_dates: dates })) as {
        outcome?: string;
      } | null;
      return result?.outcome === "applied" ? "applied" : "invalidated";
    },
    async editBatch(tripId, operations, draft) {
      await rpc("edit_trip_items", { p_trip: tripId, p_ops: operations, p_draft: draft });
    },
    async warnings(tripId, dates) {
      const view = await loadDayDraft(tripId);
      if (view.state !== "ok") return [];
      return view.days
        .filter((d) => dates.includes(d.date))
        .flatMap((d) => d.issues.map((i) => `${i.item_id ? `${view.items[i.item_id]?.nameZh ?? ""}：` : ""}${FEASIBILITY_LABELS[i.check]}`));
    },
    logError: (message) => createLogger().error(message),
  };
}
