import { expenseCategory } from "@atps/schemas";
import { describe, expect, it } from "vitest";
import {
  EXPENSE_CATEGORIES,
  budgetStatus,
  convertAmount,
  currencyDecimals,
  expenseBalances,
  expenseTotals,
  fromMinor,
  roundMoney,
  settleUp,
  splitEqually,
  toMinor,
  validateShares,
  type Expense,
  type Settlement,
} from "./expenses";

// 決策 0010 X：記帳與分帳。金額一律以幣別的最小單位（整數）計算，避免浮點誤差；
// 匯率由使用者輸入（1 單位外幣 = rate 單位主幣別），不呼叫外部匯率服務。

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";
const D = "00000000-0000-0000-0000-00000000000d";

const expense = (over: Partial<Expense> & Pick<Expense, "amount" | "paidBy" | "shares">): Expense => ({
  id: `e-${Math.random()}`,
  currency: "TWD",
  category: "food",
  ...over,
});

describe("類別", () => {
  it("與資料庫的 expense_category 相同", () => {
    expect([...EXPENSE_CATEGORIES]).toEqual(expenseCategory.options);
  });
});

describe("幣別的小數位數與四捨五入", () => {
  it("TWD、JPY、KRW 不用小數；USD、EUR 兩位；未列出的幣別預設兩位", () => {
    expect(currencyDecimals("TWD")).toBe(0);
    expect(currencyDecimals("JPY")).toBe(0);
    expect(currencyDecimals("KRW")).toBe(0);
    expect(currencyDecimals("USD")).toBe(2);
    expect(currencyDecimals("EUR")).toBe(2);
    expect(currencyDecimals("THB")).toBe(2);
  });

  it("四捨五入到幣別的位數，0.5 進位，不受浮點誤差影響", () => {
    expect(roundMoney(1.005, "USD")).toBe(1.01);
    expect(roundMoney(2.675, "USD")).toBe(2.68);
    expect(roundMoney(100.5, "TWD")).toBe(101);
    expect(roundMoney(100.49, "JPY")).toBe(100);
    expect(roundMoney(0.1 + 0.2, "USD")).toBe(0.3);
  });

  it("最小單位換算可以來回", () => {
    expect(toMinor(12.34, "USD")).toBe(1234);
    expect(fromMinor(1234, "USD")).toBe(12.34);
    expect(toMinor(1500, "JPY")).toBe(1500);
  });
});

describe("平均分攤", () => {
  it("除不盡時餘數依成員順序每人多分一個最小單位，總和等於金額", () => {
    expect(splitEqually(100, "TWD", [A, B, C])).toEqual([
      { userId: A, amount: 34 },
      { userId: B, amount: 33 },
      { userId: C, amount: 33 },
    ]);
    expect(splitEqually(10, "USD", [A, B, C])).toEqual([
      { userId: A, amount: 3.34 },
      { userId: B, amount: 3.33 },
      { userId: C, amount: 3.33 },
    ]);
  });

  it("沒有成員時回傳空陣列，重複的成員只算一次", () => {
    expect(splitEqually(100, "TWD", [])).toEqual([]);
    expect(splitEqually(100, "TWD", [A, A, B])).toEqual([
      { userId: A, amount: 50 },
      { userId: B, amount: 50 },
    ]);
  });
});

describe("自訂分攤的檢查", () => {
  it("總和等於金額時通過", () => {
    expect(validateShares(1000, "JPY", [{ userId: A, amount: 600 }, { userId: B, amount: 400 }])).toEqual({ ok: true });
    expect(validateShares(10, "USD", [{ userId: A, amount: 3.34 }, { userId: B, amount: 6.66 }])).toEqual({ ok: true });
  });

  it("總和不等於金額時說明差額", () => {
    expect(validateShares(1000, "JPY", [{ userId: A, amount: 600 }, { userId: B, amount: 300 }])).toEqual({
      ok: false,
      reason: "sum_mismatch",
      difference: 100,
    });
  });

  it("沒有分攤成員、成員重複、負數或超過幣別小數位數時不通過", () => {
    expect(validateShares(100, "TWD", [])).toMatchObject({ ok: false, reason: "empty" });
    expect(validateShares(100, "TWD", [{ userId: A, amount: 50 }, { userId: A, amount: 50 }])).toMatchObject({ ok: false, reason: "duplicate" });
    expect(validateShares(100, "TWD", [{ userId: A, amount: 150 }, { userId: B, amount: -50 }])).toMatchObject({ ok: false, reason: "negative" });
    expect(validateShares(100, "TWD", [{ userId: A, amount: 50.5 }, { userId: B, amount: 49.5 }])).toMatchObject({ ok: false, reason: "precision" });
  });

  it("金額必須大於零且符合幣別小數位數", () => {
    expect(validateShares(0, "TWD", [{ userId: A, amount: 0 }])).toMatchObject({ ok: false, reason: "amount" });
    expect(validateShares(10.5, "JPY", [{ userId: A, amount: 10.5 }])).toMatchObject({ ok: false, reason: "amount" });
  });
});

describe("匯率換算", () => {
  const rates = { JPY: 0.21, USD: 32.5 };
  it("主幣別不需要匯率；其他幣別以使用者輸入的匯率換算並四捨五入到主幣別", () => {
    expect(convertAmount(500, "TWD", "TWD", rates)).toBe(500);
    expect(convertAmount(1500, "JPY", "TWD", rates)).toBe(315);
    expect(convertAmount(10.01, "USD", "TWD", rates)).toBe(325);
  });

  it("沒有匯率時回傳 null，不猜測", () => {
    expect(convertAmount(10, "EUR", "TWD", rates)).toBeNull();
  });
});

describe("總覽：總花費與各類別", () => {
  it("以主幣別合計，類別依固定順序，沒有花費的類別為 0", () => {
    const result = expenseTotals({
      tripCurrency: "TWD",
      rates: { JPY: 0.21 },
      expenses: [
        expense({ amount: 1500, currency: "JPY", category: "food", paidBy: A, shares: [{ userId: A, amount: 1500 }] }),
        expense({ amount: 300, category: "food", paidBy: A, shares: [{ userId: A, amount: 300 }] }),
        expense({ amount: 1200, category: "transport", paidBy: B, shares: [{ userId: B, amount: 1200 }] }),
      ],
    });
    expect(result.total).toBe(1815);
    expect(result.byCategory.map((c) => c.category)).toEqual([...EXPENSE_CATEGORIES]);
    expect(result.byCategory.find((c) => c.category === "food")?.amount).toBe(615);
    expect(result.byCategory.find((c) => c.category === "transport")?.amount).toBe(1200);
    expect(result.byCategory.find((c) => c.category === "lodging")?.amount).toBe(0);
    expect(result.missingRates).toEqual([]);
    expect(result.excludedCount).toBe(0);
  });

  it("缺匯率的花費不計入總額，列出缺少的幣別與筆數", () => {
    const result = expenseTotals({
      tripCurrency: "TWD",
      rates: {},
      expenses: [
        expense({ amount: 10, currency: "USD", paidBy: A, shares: [{ userId: A, amount: 10 }] }),
        expense({ amount: 5, currency: "EUR", paidBy: A, shares: [{ userId: A, amount: 5 }] }),
        expense({ amount: 3, currency: "USD", paidBy: A, shares: [{ userId: A, amount: 3 }] }),
        expense({ amount: 100, paidBy: A, shares: [{ userId: A, amount: 100 }] }),
      ],
    });
    expect(result.total).toBe(100);
    expect(result.missingRates).toEqual(["EUR", "USD"]);
    expect(result.excludedCount).toBe(3);
  });
});

describe("與基線預算比較", () => {
  it("沒有預算時為 none", () => {
    expect(budgetStatus({ total: 100, tripCurrency: "TWD", budget: null, rates: {} })).toEqual({ state: "none" });
  });

  it("預算以主幣別計算剩餘與已用比例", () => {
    expect(budgetStatus({ total: 30000, tripCurrency: "TWD", budget: { amount: 40000, currency: "TWD" }, rates: {} })).toEqual({
      state: "within",
      budget: 40000,
      remaining: 10000,
      usedPercent: 75,
    });
  });

  it("超出預算時剩餘為負數", () => {
    expect(budgetStatus({ total: 45000, tripCurrency: "TWD", budget: { amount: 40000, currency: "TWD" }, rates: {} })).toEqual({
      state: "over",
      budget: 40000,
      remaining: -5000,
      usedPercent: 113,
    });
  });

  it("預算幣別不同時以匯率換算；沒有匯率時說明缺少的幣別", () => {
    expect(budgetStatus({ total: 21000, tripCurrency: "TWD", budget: { amount: 200000, currency: "JPY" }, rates: { JPY: 0.21 } })).toMatchObject({
      state: "within",
      budget: 42000,
      remaining: 21000,
    });
    expect(budgetStatus({ total: 1, tripCurrency: "TWD", budget: { amount: 200000, currency: "JPY" }, rates: {} })).toEqual({ state: "no_rate", currency: "JPY" });
  });
});

describe("每人餘額", () => {
  it("付款減去自己的分攤；正數為應收，負數為應付，合計為 0", () => {
    const balances = expenseBalances({
      tripCurrency: "TWD",
      rates: {},
      members: [A, B, C],
      expenses: [expense({ amount: 900, paidBy: A, shares: splitEqually(900, "TWD", [A, B, C]) })],
      settlements: [],
    });
    expect(balances).toEqual([
      { userId: A, paid: 900, share: 300, net: 600 },
      { userId: B, paid: 0, share: 300, net: -300 },
      { userId: C, paid: 0, share: 300, net: -300 },
    ]);
  });

  it("外幣花費先換算總額再依比例分配，餘數給小數最大的成員，合計仍為 0", () => {
    const balances = expenseBalances({
      tripCurrency: "TWD",
      rates: { JPY: 0.213 },
      members: [A, B, C],
      expenses: [expense({ amount: 1000, currency: "JPY", paidBy: A, shares: splitEqually(1000, "JPY", [A, B, C]) })],
      settlements: [],
    });
    // 1000 JPY = 213 TWD；334／333／333 JPY 依比例為 71.142／70.929／70.929，
    // 先取整數 71／70／70，剩下 2 元給小數最大的 B、C
    expect(balances).toEqual([
      { userId: A, paid: 213, share: 71, net: 142 },
      { userId: B, paid: 0, share: 71, net: -71 },
      { userId: C, paid: 0, share: 71, net: -71 },
    ]);
  });

  it("已記錄的結算計入餘額：付款人的應付減少，收款人的應收減少", () => {
    const settlements: Settlement[] = [{ fromUser: B, toUser: A, amount: 300, currency: "TWD" }];
    const balances = expenseBalances({
      tripCurrency: "TWD",
      rates: {},
      members: [A, B, C],
      expenses: [expense({ amount: 900, paidBy: A, shares: splitEqually(900, "TWD", [A, B, C]) })],
      settlements,
    });
    expect(balances.map((b) => b.net)).toEqual([300, 0, -300]);
  });

  it("已不在行程的成員仍列出（有花費紀錄時）", () => {
    const balances = expenseBalances({
      tripCurrency: "TWD",
      rates: {},
      members: [A],
      expenses: [expense({ amount: 200, paidBy: D, shares: splitEqually(200, "TWD", [A, D]) })],
      settlements: [],
    });
    expect(balances.map((b) => b.userId)).toEqual([A, D]);
    expect(balances.map((b) => b.net)).toEqual([-100, 100]);
  });

  it("缺匯率的花費不計入餘額", () => {
    const balances = expenseBalances({
      tripCurrency: "TWD",
      rates: {},
      members: [A, B],
      expenses: [expense({ amount: 10, currency: "USD", paidBy: A, shares: splitEqually(10, "USD", [A, B]) })],
      settlements: [],
    });
    expect(balances.map((b) => b.net)).toEqual([0, 0]);
  });
});

describe("結算：誰付給誰", () => {
  const net = (pairs: Array<[string, number]>) => pairs.map(([userId, n]) => ({ userId, paid: 0, share: 0, net: n }));

  it("一位付款人時，其他人各付一筆給他", () => {
    expect(settleUp(net([[A, 600], [B, -300], [C, -300]]), "TWD")).toEqual([
      { fromUser: B, toUser: A, amount: 300 },
      { fromUser: C, toUser: A, amount: 300 },
    ]);
  });

  it("金額相同的應付與應收先配對，減少筆數", () => {
    const transfers = settleUp(net([[A, 500], [B, 300], [C, -300], [D, -500]]), "TWD");
    expect(transfers).toEqual([
      { fromUser: D, toUser: A, amount: 500 },
      { fromUser: C, toUser: B, amount: 300 },
    ]);
  });

  it("筆數不超過有餘額的人數減一，且每人結算後餘額為 0", () => {
    const balances = net([[A, 1000], [B, -200], [C, -450], [D, -350]]);
    const transfers = settleUp(balances, "TWD");
    expect(transfers.length).toBeLessThanOrEqual(3);
    const after = new Map(balances.map((b) => [b.userId, b.net]));
    for (const t of transfers) {
      after.set(t.fromUser, (after.get(t.fromUser) ?? 0) + t.amount);
      after.set(t.toUser, (after.get(t.toUser) ?? 0) - t.amount);
    }
    expect([...after.values()].every((v) => v === 0)).toBe(true);
  });

  it("都已結清時沒有轉帳；小數幣別以最小單位計算", () => {
    expect(settleUp(net([[A, 0], [B, 0]]), "TWD")).toEqual([]);
    expect(settleUp(net([[A, 3.34], [B, -1.67], [C, -1.67]]), "USD")).toEqual([
      { fromUser: B, toUser: A, amount: 1.67 },
      { fromUser: C, toUser: A, amount: 1.67 },
    ]);
  });
});
