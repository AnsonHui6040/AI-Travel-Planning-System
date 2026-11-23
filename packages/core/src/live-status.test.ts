import { changePayload } from "@atps/schemas";
import { describe, expect, it } from "vitest";
import {
  NO_LIVE_DATA_LABEL,
  isAbnormal,
  routeLiveView,
  transitAtRiskChanges,
  type RouteStatus,
} from "./live-status";
import { classifyVersionKind } from "./versions";

// T22、D30：即時運行狀態、「無即時資料」與 At Risk

const NOW = new Date("2026-11-24T10:00:00+09:00");
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function status(routeId: string, condition: RouteStatus["condition"], validUntil: string | null = "2026-11-24T10:05:00+09:00"): RouteStatus {
  return {
    routeId,
    condition,
    text: condition === "normal" ? "平常運転" : "運転見合わせ",
    cause: null,
    resumeEstimate: null,
    observedAt: "2026-11-24T09:58:00+09:00",
    validUntil,
    source: { name: "ODPT", url: "https://api-public.odpt.org/api/v4/odpt:TrainInformation" },
  };
}

describe("isAbnormal", () => {
  it("只有正常運行不是異常", () => {
    expect(isAbnormal("normal")).toBe(false);
    expect(isAbnormal("delayed")).toBe(true);
    expect(isAbnormal("suspended")).toBe(true);
    expect(isAbnormal("other_abnormal")).toBe(true);
  });
});

describe("routeLiveView", () => {
  it("沒有來源的路線顯示「無即時資料」", () => {
    const view = routeLiveView(["odpt.Railway:Toei.Asakusa", "jr-east:yamanote"], [status("odpt.Railway:Toei.Asakusa", "normal")], NOW);
    expect(view).toEqual([
      { routeId: "odpt.Railway:Toei.Asakusa", condition: "normal", label: "正常運行", status: status("odpt.Railway:Toei.Asakusa", "normal") },
      { routeId: "jr-east:yamanote", condition: "no_data", label: NO_LIVE_DATA_LABEL, status: null },
    ]);
    expect(NO_LIVE_DATA_LABEL).toBe("無即時資料");
  });

  it("超過有效期限的資料視為沒有即時資料", () => {
    const expired = status("odpt.Railway:Toei.Asakusa", "suspended", "2026-11-24T09:59:00+09:00");
    expect(routeLiveView(["odpt.Railway:Toei.Asakusa"], [expired], NOW)[0]).toMatchObject({ condition: "no_data", label: NO_LIVE_DATA_LABEL });
  });

  it("異常狀態顯示對應文字", () => {
    const labels = (["delayed", "suspended", "other_abnormal"] as const).map(
      (c) => routeLiveView(["r"], [status("r", c)], NOW)[0]?.label,
    );
    expect(labels).toEqual(["延誤", "停駛", "運行異常"]);
  });
});

describe("transitAtRiskChanges", () => {
  const entries = [
    { id: ID(1), date: "2026-11-24", routes: ["odpt.Railway:Toei.Asakusa"], atRisk: false },
    { id: ID(2), date: "2026-11-24", routes: ["odpt.Railway:Toei.Mita"], atRisk: false },
    { id: ID(3), date: "2026-11-25", routes: ["odpt.Railway:Toei.Asakusa", "odpt.Railway:Toei.Oedo"], atRisk: false },
    { id: ID(4), date: "2026-11-24", routes: ["odpt.Railway:Toei.Asakusa"], atRisk: true },
    { id: ID(5), date: "2026-11-24", routes: ["jr-east:yamanote"], atRisk: false },
  ];

  it("異常營運的路線讓尚未標示的項目轉為 At Risk，每天一個 Minor 提案", () => {
    const statuses = [status("odpt.Railway:Toei.Asakusa", "suspended"), status("odpt.Railway:Toei.Mita", "normal")];
    const changes = transitAtRiskChanges(entries, statuses, NOW);
    expect(changes).toHaveLength(2);
    for (const change of changes) {
      expect(changePayload.parse(change)).toEqual(change);
      expect(change.changeKind).toBe("approved_fact_invalidated");
      const items = entries.map((e) => ({ id: e.id, scheduled_date: e.date }));
      expect(classifyVersionKind(change.operations, items)).toBe(change.versionKind);
      expect(change.versionKind).toBe("minor");
    }
    expect(changes.map((c) => c.operations)).toEqual([
      [{ op: "set_at_risk", itemId: ID(1), atRisk: true }],
      [{ op: "set_at_risk", itemId: ID(3), atRisk: true }],
    ]);
    expect(changes[0]?.summary).toContain("停駛");
  });

  it("延誤與其他異常也轉為 At Risk", () => {
    for (const condition of ["delayed", "other_abnormal"] as const) {
      const changes = transitAtRiskChanges(entries.slice(0, 1), [status("odpt.Railway:Toei.Asakusa", condition)], NOW);
      expect(changes.flatMap((c) => c.operations)).toEqual([{ op: "set_at_risk", itemId: ID(1), atRisk: true }]);
    }
  });

  it("正常運行、沒有資料或資料逾期時不提出變更", () => {
    expect(transitAtRiskChanges(entries, [status("odpt.Railway:Toei.Asakusa", "normal")], NOW)).toEqual([]);
    expect(transitAtRiskChanges(entries, [], NOW)).toEqual([]);
    const expired = status("odpt.Railway:Toei.Asakusa", "suspended", "2026-11-24T09:00:00+09:00");
    expect(transitAtRiskChanges(entries, [expired], NOW)).toEqual([]);
  });

  it("沒有排定日期的項目不處理", () => {
    const unscheduled = [{ id: ID(9), date: null, routes: ["odpt.Railway:Toei.Asakusa"], atRisk: false }];
    expect(transitAtRiskChanges(unscheduled, [status("odpt.Railway:Toei.Asakusa", "suspended")], NOW)).toEqual([]);
  });
});
