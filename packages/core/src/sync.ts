// 第 2.9 節同步觸發事件 → 系統動作

import type { IncidentLevel } from "./approval";
import type { LifecycleStatus } from "./states";
import type { VersionKind } from "./versions";

export type SyncEvent =
  | { type: "candidate_added"; itemId: string }
  | { type: "official_data_changed"; items: ReadonlyArray<{ id: string; lifecycle_status: LifecycleStatus }> }
  | { type: "day_approved"; date: string }
  | { type: "flight_or_hotel_changed"; subject: "flight" | "hotel" }
  | { type: "fixed_activity_rescheduled"; fromDate: string; toDate: string }
  | { type: "live_incident"; currentVersion: number; level: IncidentLevel }
  | { type: "destination_changed_on_site"; date: string; time: string }
  | { type: "day_finished"; date: string };

export type SyncAction =
  | { action: "update_candidate_list"; itemId: string }
  | { action: "set_unverified"; itemIds: string[] }
  | { action: "enqueue_reverification"; itemIds: string[] }
  | { action: "mark_at_risk"; itemIds: string[] }
  | { action: "create_master_version"; date: string; versionKind: VersionKind }
  | { action: "start_major_analysis"; subject: "flight" | "hotel" }
  | { action: "recompute_dates"; dates: string[] }
  | { action: "enter_incident_mode"; level: IncidentLevel }
  | { action: "open_live_branch"; baseVersion: number }
  | { action: "recompute_from"; date: string; time: string }
  | { action: "record_actual_timeline"; date: string }
  | { action: "set_day_status"; date: string; status: "completed" };

export function syncActions(event: SyncEvent): SyncAction[] {
  switch (event.type) {
    case "candidate_added":
      return [{ action: "update_candidate_list", itemId: event.itemId }];
    case "official_data_changed": {
      const ids = event.items.map((i) => i.id);
      const locked = event.items.filter((i) => i.lifecycle_status === "locked").map((i) => i.id);
      const actions: SyncAction[] = [
        { action: "set_unverified", itemIds: ids },
        { action: "enqueue_reverification", itemIds: ids },
      ];
      if (locked.length > 0) actions.push({ action: "mark_at_risk", itemIds: locked });
      return actions;
    }
    case "day_approved":
      // 批准一日屬同一天內的變更，以 Minor 建立新 Master Version
      return [{ action: "create_master_version", date: event.date, versionKind: "minor" }];
    case "flight_or_hotel_changed":
      return [{ action: "start_major_analysis", subject: event.subject }];
    case "fixed_activity_rescheduled":
      return [{ action: "recompute_dates", dates: [...new Set([event.fromDate, event.toDate])] }];
    case "live_incident":
      return [
        { action: "enter_incident_mode", level: event.level },
        { action: "open_live_branch", baseVersion: event.currentVersion },
      ];
    case "destination_changed_on_site":
      return [{ action: "recompute_from", date: event.date, time: event.time }];
    case "day_finished":
      return [
        { action: "record_actual_timeline", date: event.date },
        { action: "set_day_status", date: event.date, status: "completed" },
      ];
  }
}
