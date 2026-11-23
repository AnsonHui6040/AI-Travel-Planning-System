import { describe, expect, it } from "vitest";
import { parseCommonsAttribution } from "./index";

// T21、D14：Wikimedia Commons 照片的授權、作者、來源必填；規則與資料庫 photos_commons_source 相同
const valid = { license: "CC BY-SA 4.0", author: "Example Author", sourceUrl: "https://commons.wikimedia.org/wiki/File:Sensoji.jpg" };

describe("parseCommonsAttribution", () => {
  it("三個欄位齊全且格式正確時通過", () => {
    expect(parseCommonsAttribution(valid)).toEqual({ ok: true, value: valid });
  });

  it.each(["CC0 1.0", "CC BY 4.0", "CC BY-SA 3.0", "CC BY 2.0", "Public domain"])("接受授權 %s", (license) => {
    expect(parseCommonsAttribution({ ...valid, license }).ok).toBe(true);
  });

  it.each([
    [{ ...valid, license: "" }, "授權"],
    [{ ...valid, license: "保留所有權利" }, "授權"],
    [{ ...valid, license: "CC BY-NC 4.0" }, "授權"],
    [{ ...valid, author: "   " }, "作者"],
    [{ ...valid, sourceUrl: "" }, "來源"],
    [{ ...valid, sourceUrl: "http://commons.wikimedia.org/wiki/File:x.jpg" }, "來源"],
    [{ ...valid, sourceUrl: "https://evil.example/wiki/File:x.jpg" }, "來源"],
    [{ ...valid, sourceUrl: "https://commons.wikimedia.org/wiki/File:x y.jpg" }, "來源"],
  ])("缺漏或格式不合時拒絕：%j", (input, field) => {
    const result = parseCommonsAttribution(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(field);
  });

  it("作者過長時拒絕", () => {
    expect(parseCommonsAttribution({ ...valid, author: "名".repeat(201) }).ok).toBe(false);
  });
});
