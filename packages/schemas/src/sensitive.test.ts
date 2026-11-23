import { describe, expect, it } from "vitest";
import { SENSITIVE_FIELDS, parseSensitiveValue } from "./index";

// T17、D18：敏感欄位只限全名、電話、電子郵件；格式與資料庫 check 相同
describe("敏感欄位", () => {
  it("只有三個欄位，沒有護照或身分證字號", () => {
    expect([...SENSITIVE_FIELDS]).toEqual(["full_name", "phone", "email"]);
  });

  it.each([
    ["full_name", "王小明"],
    ["full_name", "Mary-Jane O'Neil"],
    ["phone", "+886 912-345-678"],
    ["phone", "(03) 1234 5678"],
    ["email", "ming@example.test"],
  ] as const)("%s 接受 %s", (field, value) => {
    expect(parseSensitiveValue(field, value)).toEqual({ ok: true, value });
  });

  it("前後空白會被去除", () => {
    expect(parseSensitiveValue("full_name", "  王小明 ")).toEqual({ ok: true, value: "王小明" });
  });

  it.each([
    ["full_name", ""],
    ["full_name", "名".repeat(81)],
    ["full_name", "王\n小明"],
    ["phone", "call me"],
    ["phone", "12345"],
    ["phone", "+".concat("1".repeat(25))],
    ["email", "not-an-email"],
    ["email", "a@b"],
    ["email", `${"a".repeat(250)}@example.test`],
  ] as const)("%s 拒絕 %j", (field, value) => {
    expect(parseSensitiveValue(field, value).ok).toBe(false);
  });

  it("錯誤訊息不含輸入值", () => {
    const result = parseSensitiveValue("email", "secret-value-123");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain("secret-value-123");
  });
});
