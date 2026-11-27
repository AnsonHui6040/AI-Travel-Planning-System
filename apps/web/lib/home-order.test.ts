import { describe, expect, it } from "vitest";
import { currentTripId, orderTrips } from "./home-order";

const trip = (id: string, rawStatus: string, startDate: string | null, endDate: string | null = startDate) => ({ id, rawStatus, startDate, endDate, timezone: "Asia/Tokyo" });
const now = new Date("2026-11-27T03:00:00Z");

describe("首頁的目前行程", () => {
  it("進行中的行程優先", () => {
    expect(currentTripId([trip("a", "planning", "2026-11-27"), trip("b", "in_progress", "2026-11-20", "2026-11-30")], now)).toBe("b");
  });

  it("沒有進行中時，日期涵蓋今天（目的地時區）的行程", () => {
    expect(currentTripId([trip("a", "planning", "2026-12-20"), trip("b", "locked", "2026-11-27", "2026-11-29")], now)).toBe("b");
  });

  it("再來是最近要出發的行程；已結束的不算", () => {
    expect(currentTripId([trip("a", "ended", "2026-11-26"), trip("b", "planning", "2026-12-20"), trip("c", "planning", "2026-12-05")], now)).toBe("c");
  });

  it("都沒有日期時為第一個未結束的行程", () => {
    expect(currentTripId([trip("a", "archived", null), trip("b", "baseline", null)], now)).toBe("b");
  });

  it("目前行程排在最上，其餘維持原順序", () => {
    const ordered = orderTrips([trip("a", "planning", null), trip("b", "baseline", null), trip("c", "in_progress", "2026-11-26", "2026-11-28")], now);
    expect(ordered.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });
});
