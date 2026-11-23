import { describe, expect, it } from "vitest";
import { syncActions } from "./index";

describe("第 2.9 節同步觸發事件", () => {
  it("新候選加入：更新 Candidate List", () => {
    expect(syncActions({ type: "candidate_added", itemId: "a" })).toEqual([
      { action: "update_candidate_list", itemId: "a" },
    ]);
  });

  it("官方資料改變：改為 Unverified 並排入重新核實；已鎖定項目另標示 At Risk", () => {
    expect(
      syncActions({
        type: "official_data_changed",
        items: [
          { id: "a", lifecycle_status: "verified" },
          { id: "b", lifecycle_status: "locked" },
        ],
      }),
    ).toEqual([
      { action: "set_unverified", itemIds: ["a", "b"] },
      { action: "enqueue_reverification", itemIds: ["a", "b"] },
      { action: "mark_at_risk", itemIds: ["b"] },
    ]);
  });

  it("官方資料改變但沒有已鎖定項目時，不標示 At Risk", () => {
    const actions = syncActions({ type: "official_data_changed", items: [{ id: "a", lifecycle_status: "draft" }] });
    expect(actions.map((a) => a.action)).not.toContain("mark_at_risk");
  });

  it("使用者批准一日行程：建立新 Master Version", () => {
    expect(syncActions({ type: "day_approved", date: "2026-12-01" })).toEqual([
      { action: "create_master_version", date: "2026-12-01", versionKind: "minor" },
    ]);
  });

  it.each(["flight", "hotel"] as const)("%s 改變：啟動 Major 變更分析", (subject) => {
    expect(syncActions({ type: "flight_or_hotel_changed", subject })).toEqual([
      { action: "start_major_analysis", subject },
    ]);
  });

  it("固定活動改時間：重算受影響日期", () => {
    expect(syncActions({ type: "fixed_activity_rescheduled", fromDate: "2026-12-02", toDate: "2026-12-03" })).toEqual([
      { action: "recompute_dates", dates: ["2026-12-02", "2026-12-03"] },
    ]);
    expect(syncActions({ type: "fixed_activity_rescheduled", fromDate: "2026-12-02", toDate: "2026-12-02" })).toEqual([
      { action: "recompute_dates", dates: ["2026-12-02"] },
    ]);
  });

  it("旅行當日延誤或突發事件：以目前版本建立即時分支並進入 Incident Mode", () => {
    expect(syncActions({ type: "live_incident", currentVersion: 7, level: "L2" })).toEqual([
      { action: "enter_incident_mode", level: "L2" },
      { action: "open_live_branch", baseVersion: 7 },
    ]);
  });

  it("使用者現場改目的地：重算目前及後續時段", () => {
    expect(syncActions({ type: "destination_changed_on_site", date: "2026-12-01", time: "15:00" })).toEqual([
      { action: "recompute_from", date: "2026-12-01", time: "15:00" },
    ]);
  });

  it("每日行程完成：記錄 Actual Timeline，每日狀態改為已完成", () => {
    expect(syncActions({ type: "day_finished", date: "2026-12-01" })).toEqual([
      { action: "record_actual_timeline", date: "2026-12-01" },
      { action: "set_day_status", date: "2026-12-01", status: "completed" },
    ]);
  });
});
