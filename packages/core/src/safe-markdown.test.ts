import { describe, expect, it } from "vitest";
import { parseSafeMarkdown, safeHttpsUrl, type MdInline } from "./index";

// T24、S-08：AI 與網頁內容的 Markdown 只解析成有限的結構，不產生 HTML

const text = (inlines: MdInline[]): string =>
  inlines.map((n) => (n.type === "text" || n.type === "code" ? n.text : text(n.children))).join("");

describe("safeHttpsUrl", () => {
  it.each(["https://www.senso-ji.jp/", "https://example.com/a?b=1#c"])("%s 允許", (url) => {
    expect(safeHttpsUrl(url)).toBe(new URL(url).href);
  });

  it.each([
    "http://example.com/",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "//evil.example/",
    "/relative",
    "https://user:pass@example.com/",
    "https://",
    "ftp://example.com/",
  ])("%s 拒絕", (url) => {
    expect(safeHttpsUrl(url)).toBeNull();
  });
});

describe("parseSafeMarkdown", () => {
  it("段落、粗體、斜體、行內程式碼、標題、清單", () => {
    const blocks = parseSafeMarkdown("## 推薦\n\n早上**人少**，*適合*拍照 `08:00`\n\n- 雷門\n- 仲見世通\n\n1. 第一\n2. 第二");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list", "list"]);
    expect(blocks[0]).toMatchObject({ type: "heading", level: 2 });
    const para = blocks[1];
    expect(para?.type === "paragraph" && para.children.map((c) => c.type)).toEqual(["text", "strong", "text", "em", "text", "code"]);
    expect(blocks[2]).toMatchObject({ type: "list", ordered: false });
    expect(blocks[3]).toMatchObject({ type: "list", ordered: true });
  });

  it("HTML 標籤（script、事件屬性、iframe）只當文字，不產生元素", () => {
    const blocks = parseSafeMarkdown('<script>alert(1)</script>\n<img src=x onerror="alert(1)">\n<iframe src="https://evil.example"></iframe>');
    expect(blocks).toHaveLength(1);
    const para = blocks[0];
    expect(para?.type).toBe("paragraph");
    if (para?.type !== "paragraph") return;
    expect(para.children.every((c) => c.type === "text")).toBe(true);
    expect(text(para.children)).toContain("<script>alert(1)</script>");
  });

  it("https 連結保留；javascript:、http、data: 連結移除，只留文字", () => {
    const [para] = parseSafeMarkdown(
      "[官網](https://www.senso-ji.jp/) [壞](javascript:alert(1)) [舊](http://example.com/) [資料](data:text/html,x)",
    );
    if (para?.type !== "paragraph") throw new Error("expected paragraph");
    const links = para.children.filter((c) => c.type === "link");
    expect(links).toEqual([{ type: "link", href: "https://www.senso-ji.jp/", children: [{ type: "text", text: "官網" }] }]);
    expect(text(para.children)).toBe("官網 壞 舊 資料");
  });

  it("裸露的 https 網址轉為連結，http 網址維持文字", () => {
    const [para] = parseSafeMarkdown("見 https://www.senso-ji.jp/ 與 http://example.com/");
    if (para?.type !== "paragraph") throw new Error("expected paragraph");
    expect(para.children.filter((c) => c.type === "link").map((c) => c.type === "link" && c.href)).toEqual(["https://www.senso-ji.jp/"]);
    expect(text(para.children)).toBe("見 https://www.senso-ji.jp/ 與 http://example.com/");
  });

  it("圖片語法不產生圖片，只留替代文字", () => {
    const [para] = parseSafeMarkdown("![淺草寺](https://example.com/a.jpg)");
    if (para?.type !== "paragraph") throw new Error("expected paragraph");
    expect(para.children.some((c) => c.type === "link")).toBe(false);
    expect(text(para.children)).toBe("淺草寺");
  });

  it("超長輸入截斷，巢狀深度有上限", () => {
    const blocks = parseSafeMarkdown("a".repeat(30_000));
    const para = blocks[0];
    expect(para?.type === "paragraph" && text(para.children).length).toBeLessThanOrEqual(20_000);
    expect(() => parseSafeMarkdown("**".repeat(5000) + "x" + "**".repeat(5000))).not.toThrow();
  });
});
