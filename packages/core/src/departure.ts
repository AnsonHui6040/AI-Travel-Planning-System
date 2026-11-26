import { classifyDelay, type IncidentInput, type IncidentLevel } from "./approval";
import { FIXED_ACTIVITY_BUFFER_MINUTES } from "./feasibility";
import { DEFAULT_TRAVEL_MINUTES } from "./schedule";
import { zonedMidnight } from "./states";

// T37：離開前檢查。現在時間、下一站是否仍值得前往、下一站狀態、即時交通、預計到達時間、下一個固定活動、最遲離開倒數。
// 純函式：時間與即時資料由呼叫端傳入（瀏覽器端計算，離線也能使用當日包）。
// 出現偏差時依決策 0004 分級（classifyDelay），L1 以上即進入 Incident Mode（T38）。

export interface DepartureStop {
  id: string;
  name: string;
  start: string;
  end: string;
  atRisk: boolean;
  // 即時資料顯示休館或暫停營業
  closed: boolean;
}

export interface DepartureInput {
  date: string;
  timezone: string;
  now: Date;
  current: { id: string; name: string; end: string };
  // 下一個行程項目；下一站是固定活動或已是最後一站時為 null
  next: DepartureStop | null;
  nextFixed: { name: string; start: string } | null;
  // 當日包的交通估算（含緩衝）
  plannedTravelMinutes: number;
  // 即時交通分鐘數；沒有即時資料時為 null
  liveTravelMinutes: number | null;
  // 路線運行異常；沒有資料時為 null
  transitAbnormal: boolean | null;
}

export interface DepartureResult {
  now: string;
  leaveBy: string | null;
  countdownMinutes: number | null;
  eta: string | null;
  // 相對下一站開始時間的延誤分鐘數
  lateMinutes: number;
  worthGoing: boolean;
  notes: string[];
  // 完成下一站並前往下一個固定活動後剩下的分鐘數；沒有固定活動時為 null
  fixedMarginMinutes: number | null;
  incident: { type: IncidentInput["type"]; level: IncidentLevel } | null;
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHhmm = (m: number) => {
  const day = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(day / 60)).padStart(2, "0")}:${String(day % 60).padStart(2, "0")}`;
};

export function departureCheck(input: DepartureInput): DepartureResult {
  const nowMin = Math.round((input.now.getTime() - zonedMidnight(input.date, input.timezone).getTime()) / 60_000);
  const notes: string[] = [];
  const { next, nextFixed } = input;
  if (!next && !nextFixed) {
    return { now: toHhmm(nowMin), leaveBy: null, countdownMinutes: null, eta: null, lateMinutes: 0, worthGoing: true, notes, fixedMarginMinutes: null, incident: null };
  }

  const travel = input.liveTravelMinutes ?? input.plannedTravelMinutes;
  if (input.liveTravelMinutes === null) notes.push("沒有即時交通資料，以估算計算");
  const eta = nowMin + travel;

  let leaveBy: number;
  let lateMinutes = 0;
  let worthGoing = true;
  let fixedMargin: number | null = null;
  if (next) {
    leaveBy = toMin(next.start) - input.plannedTravelMinutes;
    lateMinutes = Math.max(0, eta - toMin(next.start));
    const stay = toMin(next.end) - toMin(next.start);
    if (next.closed) {
      worthGoing = false;
      notes.push("下一站今天休館或暫停營業");
    } else if (eta + Math.ceil(stay / 2) > toMin(next.end)) {
      worthGoing = false;
      notes.push("抵達後停留不到原本的一半");
    }
    if (next.atRisk) notes.push("下一站標示 At Risk，出發前再確認");
    if (nextFixed) fixedMargin = toMin(nextFixed.start) - (Math.max(eta, toMin(next.start)) + stay + DEFAULT_TRAVEL_MINUTES);
  } else {
    const fixed = nextFixed as { name: string; start: string };
    leaveBy = toMin(fixed.start) - input.plannedTravelMinutes - FIXED_ACTIVITY_BUFFER_MINUTES;
    fixedMargin = toMin(fixed.start) - eta;
  }

  let incident: DepartureResult["incident"] = null;
  if (next?.closed) incident = { type: "attraction_closed", level: "L3" };
  else if (input.transitAbnormal === true) incident = { type: "rail_disruption", level: "L3" };
  else {
    const level = classifyDelay({
      delayMinutes: lateMinutes,
      bufferAfterCompressionMinutes: fixedMargin ?? Number.POSITIVE_INFINITY,
      hardConstraintMissed: fixedMargin !== null && fixedMargin < 0,
    });
    if (level !== "none") incident = { type: "delay", level };
  }

  return {
    now: toHhmm(nowMin),
    leaveBy: toHhmm(leaveBy),
    countdownMinutes: leaveBy - nowMin,
    eta: toHhmm(eta),
    lateMinutes,
    worthGoing,
    notes,
    fixedMarginMinutes: fixedMargin,
    incident,
  };
}
