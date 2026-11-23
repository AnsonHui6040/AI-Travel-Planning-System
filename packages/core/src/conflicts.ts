// 第 2.10 節衝突處理與「差異重大」標準（docs/decisions/0005-user-confirmation.md）。
// 所有結果都只產生提案或標示 At Risk；行程改動一律由使用者選擇後經 applyChange 套用。

import { enums } from "@atps/schemas";

export type SourceGrade = (typeof enums.sourceGrade.options)[number];

export const SIGNIFICANCE_THRESHOLDS = { timeShiftMinutes: 20, costPerPersonTwd: 1000, budgetRatio: 0.2 } as const;

export interface SignificanceInput {
  // 受影響項目中，開始或結束時間相差最多的分鐘數
  maxTimeShiftMinutes: number;
  hardConstraintMissed: boolean;
  movesToAnotherDay: boolean;
  affectedDays: number;
  extraCostPerPersonTwd: number;
  itemBudgetPerPersonTwd: number | null;
  paidOrReservedChange: boolean;
  mustVisitRemoved: boolean;
}

export type SignificanceReason = "time" | "hard_constraint" | "date" | "cost" | "paid_or_reserved" | "must_visit";

// 回傳成立的條件；空陣列即差異不重大
export function significanceReasons(input: SignificanceInput): SignificanceReason[] {
  const numbers = [input.maxTimeShiftMinutes, input.affectedDays, input.extraCostPerPersonTwd, input.itemBudgetPerPersonTwd ?? 0];
  if (numbers.some((n) => !Number.isFinite(n) || n < 0)) throw new Error("差異數值不可為負數");

  const t = SIGNIFICANCE_THRESHOLDS;
  const budget = input.itemBudgetPerPersonTwd;
  const checks: Array<[SignificanceReason, boolean]> = [
    ["time", input.maxTimeShiftMinutes > t.timeShiftMinutes],
    ["hard_constraint", input.hardConstraintMissed],
    ["date", input.movesToAnotherDay || input.affectedDays >= 2],
    [
      "cost",
      input.extraCostPerPersonTwd >= t.costPerPersonTwd ||
        (budget !== null && budget > 0 && input.extraCostPerPersonTwd > budget * t.budgetRatio),
    ],
    ["paid_or_reserved", input.paidOrReservedChange],
    ["must_visit", input.mustVisitRemoved],
  ];
  return checks.filter(([, hit]) => hit).map(([reason]) => reason);
}

// 第 2.5 節證據順序：越前面越可靠；同級回傳 null
const EVIDENCE_ORDER: readonly SourceGrade[] = enums.sourceGrade.options;

export function moreReliableSource(a: SourceGrade, b: SourceGrade): "a" | "b" | null {
  const ra = EVIDENCE_ORDER.indexOf(a);
  const rb = EVIDENCE_ORDER.indexOf(b);
  if (ra === rb) return null;
  return ra < rb ? "a" : "b";
}

// 使用者在下一層看到的選項：方案、請 AI 重新排列（可加入新地點）、維持原狀
export const USER_CHOICES = ["apply_option", "ask_ai_rearrange", "keep_original"] as const;
export type UserChoice = (typeof USER_CHOICES)[number];

export type ConflictInput =
  | {
      type: "disagreement";
      affectsCommitted: boolean;
      sourceA: SourceGrade;
      sourceB: SourceGrade;
      // 行程時間或內容受影響時提供；沒有明確較可靠資料時必填
      itineraryImpact?: SignificanceInput;
    }
  | { type: "fact_invalidated"; itineraryImpact?: SignificanceInput };

interface ResolutionBase {
  factProposal: boolean;
  markAtRisk: boolean;
  itineraryProposals: "none" | "single" | "multiple";
  userChoices: readonly UserChoice[];
}

export type ConflictResolution =
  | ({ outcome: "keep_candidates" } & ResolutionBase)
  | ({ outcome: "adopt_reliable"; adopt: "a" | "b" } & ResolutionBase)
  | ({ outcome: "single_proposal" | "multiple_proposals"; reasons: SignificanceReason[] } & ResolutionBase)
  | ({ outcome: "replan" } & ResolutionBase);

const proposalsFor = (impact: SignificanceInput) => (significanceReasons(impact).length > 0 ? "multiple" : "single");

export function resolveConflict(input: ConflictInput): ConflictResolution {
  if (input.type === "fact_invalidated") {
    return {
      outcome: "replan",
      factProposal: false,
      markAtRisk: true,
      itineraryProposals: input.itineraryImpact ? proposalsFor(input.itineraryImpact) : "single",
      userChoices: USER_CHOICES,
    };
  }

  if (!input.affectsCommitted) {
    return { outcome: "keep_candidates", factProposal: false, markAtRisk: false, itineraryProposals: "none", userChoices: [] };
  }

  const adopt = moreReliableSource(input.sourceA, input.sourceB);
  if (adopt) {
    const impact = input.itineraryImpact;
    return {
      outcome: "adopt_reliable",
      adopt,
      factProposal: true,
      markAtRisk: impact !== undefined,
      itineraryProposals: impact ? proposalsFor(impact) : "none",
      userChoices: USER_CHOICES,
    };
  }

  if (!input.itineraryImpact) throw new Error("沒有明確較可靠資料時須提供行程影響");
  const reasons = significanceReasons(input.itineraryImpact);
  const significant = reasons.length > 0;
  return {
    outcome: significant ? "multiple_proposals" : "single_proposal",
    factProposal: false,
    markAtRisk: true,
    itineraryProposals: significant ? "multiple" : "single",
    userChoices: USER_CHOICES,
    reasons,
  };
}
