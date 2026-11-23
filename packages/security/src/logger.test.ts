import { describe, expect, it } from "vitest";
import { createLogger, redactSensitive } from "./index";

// T17、S-10、C-04：log 與 AI 請求紀錄遮罩 API key 與敏感欄位
describe("redactSensitive", () => {
  it("遮罩已知的敏感欄位值，短的全名也遮罩", () => {
    const out = redactSensitive("聯絡人 王明，電話 0912345678", { sensitiveValues: ["王明", "0912345678"] });
    expect(out).not.toContain("王明");
    expect(out).not.toContain("0912345678");
  });

  it("沒有列出的電子郵件與電話格式也遮罩", () => {
    const out = redactSensitive("寄給 hua@example.test 或撥 +886 912-345-678", {});
    expect(out).not.toContain("hua@example.test");
    expect(out).not.toContain("912-345-678");
  });

  it("同時遮罩 API key", () => {
    const out = redactSensitive("key sk-ant-api03-abcdefghijkl 失敗", { secrets: ["sk-ant-api03-abcdefghijkl"] });
    expect(out).not.toContain("abcdefghijkl");
  });

  it("一般文字與日期時間不受影響", () => {
    expect(redactSensitive("2026-12-03 16:00 淺草寺 90 分鐘", {})).toBe("2026-12-03 16:00 淺草寺 90 分鐘");
  });
});

describe("createLogger", () => {
  it("訊息與附帶資料都經遮罩後才寫出", () => {
    const lines: string[] = [];
    // 測試用假值
    const fake = "test-only-value-1234";
    const log = createLogger({ write: (line) => lines.push(line), sensitiveValues: () => ["王小明"], secrets: () => [fake] });
    log.error("儲存失敗：王小明", { email: "ming@example.test", credential: fake, nested: { phone: "+81 90-1234-5678" } });
    expect(lines).toHaveLength(1);
    const line = lines[0] ?? "";
    for (const leaked of ["王小明", "ming@example.test", fake, "90-1234-5678"]) expect(line).not.toContain(leaked);
    expect(JSON.parse(line)).toMatchObject({ level: "error" });
  });

  it("無法序列化的資料不會讓 log 失敗", () => {
    const lines: string[] = [];
    const log = createLogger({ write: (line) => lines.push(line) });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => log.warn("循環", cyclic)).not.toThrow();
    expect(lines).toHaveLength(1);
  });
});
