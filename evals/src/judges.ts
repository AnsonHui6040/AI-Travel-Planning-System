import { approvalRule } from "@atps/core";
import type { JudgeSpec, PlannerOutput, Scenario, TripItem } from "./scenario";

// T15：硬性規則判定器。只看 AI 輸出的變更提案與場景的行程資料，結果固定（不呼叫 AI）

export interface JudgeResult {
  judge: JudgeSpec["type"] | "known_items";
  pass: boolean;
  detail: string;
}

type Operation = PlannerOutput["proposals"][number]["operations"][number];

interface Touch {
  op: Operation;
  item: TripItem | undefined;
}

const names = (items: string[]): string => [...new Set(items)].join("、");

function touches(output: PlannerOutput, scenario: Scenario): Touch[] {
  const byId = new Map(scenario.trip.items.map((i) => [i.id, i]));
  return output.proposals.flatMap((p) => p.operations.map((op) => ({ op, item: byId.get(op.itemId) })));
}

function result(judge: JudgeResult["judge"], offenders: string[], ok: string, bad: string): JudgeResult {
  return offenders.length === 0
    ? { judge, pass: true, detail: ok }
    : { judge, pass: false, detail: `${bad}：${names(offenders)}` };
}

const label = (t: Touch | Known): string => t.item?.name ?? t.op.itemId;

interface Known {
  op: Operation;
  item: TripItem;
}

const isKnown = (t: Touch): t is Known => t.item !== undefined;

function judgeOne(spec: JudgeSpec, output: PlannerOutput, all: Touch[]): JudgeResult {
  const list = all.filter(isKnown);
  switch (spec.type) {
    case "within_window": {
      const inWindow = (date: string | null, start: string | null, end: string | null, overlap: boolean) =>
        date === spec.date &&
        start !== null &&
        end !== null &&
        (overlap ? start < spec.to && end > spec.from : start >= spec.from && end <= spec.to);
      const offenders = list.filter(({ op, item }) => {
        const before = item.date === null || inWindow(item.date, item.start, item.end, true);
        if (op.op === "set_at_risk") return !before;
        const after = op.date === null || inWindow(op.date, op.start, op.end, false);
        return !before || !after;
      });
      return result(spec.type, offenders.map(label), `只調整 ${spec.date} ${spec.from}–${spec.to}`, `調整了時段以外的項目`);
    }
    case "dates_unchanged": {
      const dates = new Set(spec.dates);
      const offenders = list.filter(
        ({ op, item }) => (item.date !== null && dates.has(item.date)) || (op.op === "schedule_item" && op.date !== null && dates.has(op.date)),
      );
      return result(spec.type, offenders.map(label), `${spec.dates.join("、")} 無變更`, "改動了不應變更的日期");
    }
    case "items_preserved": {
      const keep = new Set(spec.itemIds);
      const offenders = list.filter(({ op }) => op.op === "schedule_item" && keep.has(op.itemId));
      return result(spec.type, offenders.map(label), "指定項目保留原時段", "重新排程了應保留的項目");
    }
    case "only_candidates": {
      const offenders = list.filter(
        ({ op, item }) => op.op === "schedule_item" && op.date !== null && item.date === null && item.status !== "candidate",
      );
      return result(spec.type, offenders.map(label), "排入的項目都來自候選清單", "排入了候選清單以外的項目");
    }
    case "requires_approval": {
      const offenders = output.proposals.filter((p) => approvalRule(p.changeKind).apply !== "approval").map((p) => p.changeKind);
      return result(spec.type, offenders, "每個提案都需要批准", "有不需批准即套用的提案種類");
    }
    case "change_kind": {
      const allowed = new Set<string>(spec.allowed);
      const offenders = output.proposals.filter((p) => !allowed.has(p.changeKind)).map((p) => p.changeKind);
      return result(spec.type, offenders, `變更種類為 ${spec.allowed.join("、")}`, "變更種類不符");
    }
    case "proposal_count": {
      const n = output.proposals.length;
      const pass = n >= spec.min && n <= spec.max;
      return { judge: spec.type, pass, detail: `提案 ${n} 個（應為 ${spec.min}–${spec.max} 個）` };
    }
  }
}

export function judgeOutput(scenario: Scenario, output: PlannerOutput): JudgeResult[] {
  const all = touches(output, scenario);
  const unknown = all.filter((t) => !t.item).map((t) => t.op.itemId);
  const known = result("known_items", unknown, "操作的項目都在行程資料中", "操作了不存在的項目");
  return [known, ...scenario.judges.map((spec) => judgeOne(spec, output, all))];
}
