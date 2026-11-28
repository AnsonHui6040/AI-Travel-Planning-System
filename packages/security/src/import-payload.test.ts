import { describe, expect, it } from "vitest";
import { IMPORT_TEXT_MAX, buildImportPayload } from "./import-payload";

// 決策 0010 I、S-07：貼上的文字送 AI 前移除全名、電話與電子郵件

const EMAIL = `訂房確認
預訂者姓名：王小明
Guest name: WANG XIAO MING
聯絡電話：+886 912-345-678
手機 0912345678
Email: xiaoming.wang@example.com
飯店電話 03-1234-5678
入住 2026-12-20 15:00，退房 2026-12-23 11:00
訂單編號 HTL-55821
航班 JL802 08:30 起飛`;

describe("buildImportPayload", () => {
  it("移除電子郵件、電話與標示為姓名的值，保留日期、時間、訂單編號與航班", () => {
    const { text, removed } = buildImportPayload(EMAIL, { knownValues: [] });
    expect(text).not.toContain("xiaoming.wang@example.com");
    expect(text).not.toContain("912-345-678");
    expect(text).not.toContain("0912345678");
    expect(text).not.toContain("03-1234-5678");
    expect(text).not.toContain("王小明");
    expect(text).not.toContain("WANG XIAO MING");
    expect(text).toContain("〔已移除電子郵件〕");
    expect(text).toContain("〔已移除電話〕");
    expect(text).toContain("預訂者姓名：〔已移除姓名〕");
    for (const keep of ["2026-12-20 15:00", "2026-12-23 11:00", "HTL-55821", "JL802 08:30"]) expect(text).toContain(keep);
    expect(removed).toEqual({ email: 1, phone: 3, name: 2 });
  });

  it("成員已登錄的全名、電話、電子郵件（含大小寫與空白差異）一律移除", () => {
    const { text } = buildImportPayload("同行：陳美華（Mei-Hua Chen），行程 12/21 淺草寺", { knownValues: ["陳美華", "mei-hua  chen"] });
    expect(text).toBe("同行：〔已移除姓名〕（〔已移除姓名〕），行程 12/21 淺草寺");
  });

  it("日文與英文的姓名標示也會移除", () => {
    const { text } = buildImportPayload("氏名: 山田 太郎\n代表者：Taro Yamada\nPassenger: CHEN/MEIHUA MS\n席 23A", { knownValues: [] });
    expect(text).toBe("氏名: 〔已移除姓名〕\n代表者：〔已移除姓名〕\nPassenger: 〔已移除姓名〕\n席 23A");
  });

  it("超過上限的文字截斷，空白與換行整理後回傳", () => {
    const { text, truncated } = buildImportPayload(`  ${"字".repeat(IMPORT_TEXT_MAX + 5)}  `, { knownValues: [] });
    expect([...text]).toHaveLength(IMPORT_TEXT_MAX);
    expect(truncated).toBe(true);
    expect(buildImportPayload("a\r\nb", { knownValues: [] }).text).toBe("a\nb");
  });
});
