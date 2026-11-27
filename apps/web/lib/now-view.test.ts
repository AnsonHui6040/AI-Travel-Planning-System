import { describe, expect, it } from "vitest";
import type { DayPack } from "@atps/offline";
import { nowStop, planningSteps, tripPhase } from "./now-view";

// 「現在」分頁：依行程狀態決定顯示內容；旅行中算出下一站與時間軸標記；規劃中算出目前步驟

const entry = (itemId: string, name: string, start: string, end: string, leaveBy: string | null, nextName: string | null, travel: number | null) => ({
  itemId,
  name,
  nameLocal: null,
  address: null,
  start,
  end,
  atRisk: false,
  verificationStatus: "verified",
  leaveBy,
  nextName,
  travelToNextMinutes: travel,
});

const pack: DayPack = {
  format: 1,
  tripId: "t",
  date: "2026-12-10",
  timezone: "Asia/Tokyo",
  baseVersion: 1,
  generatedAt: "2026-12-10T00:00:00Z",
  entries: [
    entry("a", "淺草寺", "09:00", "10:30", "10:30", "晴空塔", 30),
    entry("b", "晴空塔", "11:00", "12:30", "13:20", "上野公園", 40),
    entry("c", "上野公園", "14:00", "15:30", "18:30", "晚餐（已付款）", 15),
  ],
  fixed: [{ name: "晚餐（已付款）", start: "19:00", end: "21:00" }],
  backups: [],
  photos: [],
};

// 東京時間
const at = (hhmm: string, date = "2026-12-10") => new Date(`${date}T${hhmm}:00+09:00`);

describe("tripPhase", () => {
  it.each([
    ["baseline", "planning"],
    ["planning", "planning"],
    ["locked", "trip"],
    ["in_progress", "trip"],
    ["ended", "post"],
    ["archived", "post"],
  ])("%s 為 %s", (status, phase) => {
    expect(tripPhase(status)).toBe(phase);
  });
});

describe("nowStop", () => {
  it("第一站開始前：下一站是第一站，沒有最遲離開", () => {
    const view = nowStop(pack, at("08:10"));
    expect(view.next).toMatchObject({ kind: "item", name: "淺草寺", start: "09:00", leaveBy: null });
    expect(view.countdownMinutes).toBeNull();
    expect(view.departureIndex).toBeNull();
    expect(view.rows.map((r) => r.state)).toEqual(["next", "upcoming", "upcoming", "upcoming"]);
  });

  it("在淺草寺時：下一站是晴空塔，最遲離開與倒數取自淺草寺", () => {
    const view = nowStop(pack, at("09:48"));
    expect(view.next).toMatchObject({ kind: "item", name: "晴空塔", start: "11:00", leaveBy: "10:30", travelMinutes: 30, itemId: "b" });
    expect(view.countdownMinutes).toBe(42);
    expect(view.departureIndex).toBe(0);
    expect(view.rows.map((r) => r.state)).toEqual(["current", "next", "upcoming", "upcoming"]);
  });

  it("最後一個項目之後：下一站是固定活動", () => {
    const view = nowStop(pack, at("16:00"));
    expect(view.next).toMatchObject({ kind: "fixed", name: "晚餐（已付款）", start: "19:00", leaveBy: "18:30" });
    expect(view.rows.map((r) => r.state)).toEqual(["done", "done", "current", "next"]);
  });

  it("全部結束：沒有下一站", () => {
    const view = nowStop(pack, at("22:00"));
    expect(view.next).toBeNull();
    expect(view.rows.every((r) => r.state === "done")).toBe(true);
  });

  it("不是當天：顯示第一站預覽，不倒數", () => {
    const view = nowStop(pack, at("10:00", "2026-12-09"));
    expect(view.isToday).toBe(false);
    expect(view.next).toMatchObject({ name: "淺草寺" });
    expect(view.countdownMinutes).toBeNull();
    expect(view.rows.map((r) => r.state)).toEqual(["upcoming", "upcoming", "upcoming", "upcoming"]);
  });

  it("超過最遲離開時間時倒數為負數", () => {
    expect(nowStop(pack, at("10:40")).countdownMinutes).toBe(-10);
  });
});

describe("planningSteps", () => {
  const base = { tripStatus: "planning", candidates: 0, usable: 0, unverified: 0, researchRunning: false, days: [] as Array<{ date: string; status: string; placed: number; blocked: boolean }> };

  it("尚未確認基線：第 1 步", () => {
    const s = planningSteps({ ...base, tripStatus: "baseline" });
    expect(s.current).toBe("baseline");
    expect(s.steps.map((x) => x.state)).toEqual(["current", "todo", "todo", "todo", "todo"]);
  });

  it("已確認基線、沒有候選：研究", () => {
    expect(planningSteps(base).current).toBe("research");
  });

  it("有候選但仍有未核實：候選", () => {
    expect(planningSteps({ ...base, candidates: 4, usable: 2, unverified: 2 }).current).toBe("candidates");
  });

  it("候選都已處理、草案有會擋下的問題：每日，指向第一個有問題的日期", () => {
    const s = planningSteps({
      ...base,
      candidates: 4,
      usable: 4,
      days: [
        { date: "2026-12-01", status: "draft", placed: 2, blocked: false },
        { date: "2026-12-02", status: "draft", placed: 1, blocked: true },
      ],
    });
    expect(s.current).toBe("days");
    expect(s.focusDate).toBe("2026-12-02");
  });

  it("草案都可批准：批准，指向第一個未批准的日期", () => {
    const s = planningSteps({
      ...base,
      candidates: 4,
      usable: 4,
      days: [
        { date: "2026-12-01", status: "approved", placed: 2, blocked: false },
        { date: "2026-12-02", status: "draft", placed: 1, blocked: false },
      ],
    });
    expect(s.current).toBe("approve");
    expect(s.focusDate).toBe("2026-12-02");
    expect(s.steps.map((x) => x.state)).toEqual(["done", "done", "done", "done", "current"]);
  });

  it("已有批准的日期時，前面的步驟視為完成（即使仍有未核實候選）", () => {
    const s = planningSteps({ ...base, candidates: 4, usable: 2, unverified: 2, days: [{ date: "2026-12-01", status: "approved", placed: 2, blocked: false }, { date: "2026-12-02", status: "draft", placed: 0, blocked: false }] });
    expect(s.steps.slice(0, 3).map((x) => x.state)).toEqual(["done", "done", "done"]);
  });
});
