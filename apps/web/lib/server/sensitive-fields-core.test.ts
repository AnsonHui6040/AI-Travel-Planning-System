import { describe, expect, it } from "vitest";
import { SensitiveFieldFormatError } from "@atps/db";
import { sensitiveFieldAction, type SensitiveActionDeps } from "./sensitive-fields-core";

// T17：「我的聯絡資料」Server Action。使用者由資料庫取自 session；回應與 log 不含值
const TRIP = "a7000000-0000-4000-8000-000000000001";

function deps(overrides: Partial<SensitiveActionDeps> = {}) {
  const calls: unknown[][] = [];
  const logs: string[] = [];
  const base: SensitiveActionDeps = {
    getUser: async () => ({ id: "00000000-0000-4000-8000-0000000000a1" }),
    checkRateLimit: async () => true,
    fields: {
      save: async (...args) => {
        calls.push(["save", ...args]);
      },
      setSharing: async (...args) => {
        calls.push(["setSharing", ...args]);
      },
    },
    logError: (message, values) => logs.push(`${message}|${values.length}`),
    ...overrides,
  };
  return { deps: base, calls, logs };
}

function form(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("sensitiveFieldAction", () => {
  it("儲存值與三個開關；未勾選的開關為關閉", async () => {
    const d = deps();
    const result = await sensitiveFieldAction(d.deps, form({ tripId: TRIP, field: "phone", value: " +886 912-345-678 ", share_members: "on" }));
    expect(result).toEqual({ ok: true, message: "已儲存電話" });
    expect(d.calls).toEqual([
      ["save", TRIP, "phone", "+886 912-345-678"],
      ["setSharing", TRIP, "phone", { ai: false, members: true, viewers: false }],
    ]);
  });

  it("清空值即刪除，不設定開關", async () => {
    const d = deps();
    expect(await sensitiveFieldAction(d.deps, form({ tripId: TRIP, field: "email", value: "", share_ai: "on" }))).toEqual({
      ok: true,
      message: "已刪除電子郵件",
    });
    expect(d.calls).toEqual([["save", TRIP, "email", ""]]);
  });

  it("格式不正確時不儲存，訊息不含輸入值", async () => {
    const d = deps();
    const result = await sensitiveFieldAction(d.deps, form({ tripId: TRIP, field: "email", value: "secret-not-email" }));
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain("secret-not-email");
    expect(d.calls).toEqual([]);
  });

  it.each([
    [{ tripId: "not-a-uuid", field: "phone", value: "0912345678" }, "行程不正確"],
    [{ tripId: TRIP, field: "passport", value: "X1234567" }, "不支援的欄位"],
  ])("不合格的輸入被拒：%j", async (entries, message) => {
    const d = deps();
    expect(await sensitiveFieldAction(d.deps, form(entries))).toEqual({ ok: false, message });
    expect(d.calls).toEqual([]);
  });

  it("未登入或超過速率限制時拒絕", async () => {
    expect(await sensitiveFieldAction(deps({ getUser: async () => null }).deps, form({ tripId: TRIP, field: "phone", value: "0912345678" }))).toEqual({
      ok: false,
      message: "需要登入",
    });
    expect(
      (await sensitiveFieldAction(deps({ checkRateLimit: async () => false }).deps, form({ tripId: TRIP, field: "phone", value: "0912345678" }))).ok,
    ).toBe(false);
  });

  it("資料庫判定格式錯誤時回報欄位錯誤", async () => {
    const d = deps({
      fields: {
        save: async () => {
          throw new SensitiveFieldFormatError();
        },
        setSharing: async () => {},
      },
    });
    expect(await sensitiveFieldAction(d.deps, form({ tripId: TRIP, field: "full_name", value: "王小明" }))).toEqual({
      ok: false,
      message: "全名格式不正確",
    });
  });

  it("其他失敗回報固定訊息，log 時附上要遮罩的值", async () => {
    const d = deps({
      fields: {
        save: async () => {
          throw new Error("不是此行程的成員 王小明");
        },
        setSharing: async () => {},
      },
    });
    const result = await sensitiveFieldAction(d.deps, form({ tripId: TRIP, field: "full_name", value: "王小明" }));
    expect(result).toEqual({ ok: false, message: "儲存失敗，請確認你是此行程的成員" });
    expect(d.logs).toEqual(["儲存敏感欄位失敗|1"]);
  });
});
