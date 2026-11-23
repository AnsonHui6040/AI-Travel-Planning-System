import { describe, expect, it } from "vitest";
import {
  SIGNIFICANCE_THRESHOLDS,
  USER_CHOICES,
  approvalRule,
  moreReliableSource,
  resolveConflict,
  significanceReasons,
  type SignificanceInput,
} from "./index";

const minorDiff: SignificanceInput = {
  maxTimeShiftMinutes: 20,
  hardConstraintMissed: false,
  movesToAnotherDay: false,
  affectedDays: 1,
  extraCostPerPersonTwd: 999,
  itemBudgetPerPersonTwd: null,
  paidOrReservedChange: false,
  mustVisitRemoved: false,
};

describe("差異重大（決策 0005）", () => {
  it("門檻與決策紀錄一致", () => {
    expect(SIGNIFICANCE_THRESHOLDS).toEqual({ timeShiftMinutes: 20, costPerPersonTwd: 1000, budgetRatio: 0.2 });
  });

  it("所有條件都未達門檻時不重大", () => {
    expect(significanceReasons(minorDiff)).toEqual([]);
  });

  it.each([
    ["時間相差超過 20 分鐘", { maxTimeShiftMinutes: 21 }, "time"],
    ["下一個 Hard Constraint 無法準時", { hardConstraintMissed: true }, "hard_constraint"],
    ["項目移到另一天", { movesToAnotherDay: true }, "date"],
    ["影響兩天以上", { affectedDays: 2 }, "date"],
    ["每人增加 NT$1,000", { extraCostPerPersonTwd: 1000 }, "cost"],
    ["超過該項預算 20%", { extraCostPerPersonTwd: 201, itemBudgetPerPersonTwd: 1000 }, "cost"],
    ["已付款或已預約項目需取消或改期", { paidOrReservedChange: true }, "paid_or_reserved"],
    ["必去地點被刪除", { mustVisitRemoved: true }, "must_visit"],
  ] as const)("%s", (_, patch, reason) => {
    expect(significanceReasons({ ...minorDiff, ...patch })).toEqual([reason]);
  });

  it("剛好是預算 20% 時不重大", () => {
    expect(significanceReasons({ ...minorDiff, extraCostPerPersonTwd: 200, itemBudgetPerPersonTwd: 1000 })).toEqual([]);
  });

  it("多個條件成立時全部列出，依面向排序", () => {
    expect(significanceReasons({ ...minorDiff, mustVisitRemoved: true, maxTimeShiftMinutes: 90 })).toEqual([
      "time",
      "must_visit",
    ]);
  });

  it("數值不可為負數", () => {
    expect(() => significanceReasons({ ...minorDiff, maxTimeShiftMinutes: -1 })).toThrow();
    expect(() => significanceReasons({ ...minorDiff, affectedDays: -1 })).toThrow();
  });
});

describe("證據順序", () => {
  it.each([
    ["facility_official", "reliable_third_party", "a"],
    ["user_reviews", "official_transport_tourism", "b"],
    ["reliable_third_party", "reliable_third_party", null],
  ] as const)("%s 對 %s", (a, b, expected) => {
    expect(moreReliableSource(a, b)).toBe(expected);
  });
});

describe("第 2.10 節衝突處理", () => {
  const significant: SignificanceInput = { ...minorDiff, maxTimeShiftMinutes: 45 };

  it("不影響已批准或已鎖定行程：全部保留在 Candidate List", () => {
    expect(
      resolveConflict({ type: "disagreement", affectsCommitted: false, sourceA: "facility_official", sourceB: "user_reviews" }),
    ).toEqual({
      outcome: "keep_candidates",
      factProposal: false,
      markAtRisk: false,
      itineraryProposals: "none",
      userChoices: [],
    });
  });

  it("有明確較可靠資料：產生採用提案需確認；行程受影響時標示 At Risk 並產生提案", () => {
    expect(
      resolveConflict({
        type: "disagreement",
        affectsCommitted: true,
        sourceA: "facility_official",
        sourceB: "reliable_third_party",
        itineraryImpact: minorDiff,
      }),
    ).toEqual({
      outcome: "adopt_reliable",
      adopt: "a",
      factProposal: true,
      markAtRisk: true,
      itineraryProposals: "single",
      userChoices: USER_CHOICES,
    });
  });

  it("有明確較可靠資料但行程時間與內容不受影響：只產生採用提案", () => {
    expect(
      resolveConflict({ type: "disagreement", affectsCommitted: true, sourceA: "user_reviews", sourceB: "facility_official" }),
    ).toEqual({
      outcome: "adopt_reliable",
      adopt: "b",
      factProposal: true,
      markAtRisk: false,
      itineraryProposals: "none",
      userChoices: USER_CHOICES,
    });
  });

  it("沒有明確較可靠資料、差異不重大：單一建議提案", () => {
    expect(
      resolveConflict({
        type: "disagreement",
        affectsCommitted: true,
        sourceA: "reliable_third_party",
        sourceB: "reliable_third_party",
        itineraryImpact: minorDiff,
      }),
    ).toEqual({
      outcome: "single_proposal",
      factProposal: false,
      markAtRisk: true,
      itineraryProposals: "single",
      userChoices: USER_CHOICES,
      reasons: [],
    });
  });

  it("沒有明確較可靠資料、差異重大：多個方案由使用者選擇", () => {
    expect(
      resolveConflict({
        type: "disagreement",
        affectsCommitted: true,
        sourceA: "user_reviews",
        sourceB: "user_reviews",
        itineraryImpact: significant,
      }),
    ).toEqual({
      outcome: "multiple_proposals",
      factProposal: false,
      markAtRisk: true,
      itineraryProposals: "multiple",
      userChoices: USER_CHOICES,
      reasons: ["time"],
    });
  });

  it("沒有明確較可靠資料時必須提供行程影響", () => {
    expect(() =>
      resolveConflict({ type: "disagreement", affectsCommitted: true, sourceA: "user_reviews", sourceB: "user_reviews" }),
    ).toThrow();
  });

  it("基礎事實失效：標示 At Risk 並直接產生重新規劃提案", () => {
    expect(resolveConflict({ type: "fact_invalidated" })).toEqual({
      outcome: "replan",
      factProposal: false,
      markAtRisk: true,
      itineraryProposals: "single",
      userChoices: USER_CHOICES,
    });
  });

  it("基礎事實失效且差異重大：多個重新規劃方案", () => {
    expect(resolveConflict({ type: "fact_invalidated", itineraryImpact: significant }).itineraryProposals).toBe("multiple");
  });

  it("每個需要選擇的結果都提供方案、請 AI 重新排列、維持原狀", () => {
    expect(USER_CHOICES).toEqual(["apply_option", "ask_ai_rearrange", "keep_original"]);
  });
});

describe("事實資料更正不直接改動已批准或已鎖定行程（D10）", () => {
  it("事實資料更正需確認", () => {
    expect(approvalRule("fact_correction").apply).toBe("approval");
  });

  it("衝突處理結果都不會直接套用", () => {
    const results = [
      resolveConflict({ type: "disagreement", affectsCommitted: true, sourceA: "facility_official", sourceB: "user_reviews", itineraryImpact: significant() }),
      resolveConflict({ type: "fact_invalidated" }),
    ];
    for (const r of results) expect(r.userChoices).toContain("keep_original");
  });

  function significant(): SignificanceInput {
    return { ...minorDiff, movesToAnotherDay: true };
  }
});
