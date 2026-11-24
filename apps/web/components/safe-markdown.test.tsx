import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SafeLink, SafeMarkdown } from "./safe-markdown";

// T24、S-08：AI 與網頁內容共用的呈現元件。只輸出有限的元素，不使用 dangerouslySetInnerHTML

const html = (source: string) => renderToStaticMarkup(<SafeMarkdown source={source} />);

describe("SafeMarkdown", () => {
  it("script、事件屬性、iframe 以文字呈現，不產生可執行的元素", () => {
    const out = html('<script>alert(1)</script> <img src=x onerror="alert(1)"> <iframe src="https://evil.example"></iframe>');
    expect(out).not.toMatch(/<script|<img|<iframe/i);
    // onerror 只以轉義後的文字出現，不在任何標籤的屬性中
    expect(out).not.toMatch(/<[^>]*\son\w+=/i);
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("javascript: 與非 https 連結被移除，只留文字", () => {
    const out = html('[壞](javascript:alert(1)) [舊](http://example.com/) <a href="javascript:alert(1)">x</a>');
    expect(out).not.toMatch(/href="(javascript|http:)/i);
    expect(out).not.toContain("<a ");
  });

  it('保留的 https 連結帶 rel="noopener noreferrer" 並另開分頁', () => {
    const out = html("[官網](https://www.senso-ji.jp/)");
    expect(out).toContain('<a href="https://www.senso-ji.jp/" rel="noopener noreferrer" target="_blank">官網</a>');
  });

  it("標題、清單、粗體以對應元素呈現", () => {
    const out = html("## 推薦\n\n- **早上**人少");
    expect(out).toContain("<h4>推薦</h4>");
    expect(out).toContain("<ul><li><strong>早上</strong>人少</li></ul>");
  });
});

describe("SafeLink", () => {
  it("https 來源網址呈現為連結", () => {
    expect(renderToStaticMarkup(<SafeLink href="https://www.senso-ji.jp/">官網</SafeLink>)).toBe(
      '<a href="https://www.senso-ji.jp/" rel="noopener noreferrer" target="_blank">官網</a>',
    );
  });

  it("非 https 網址只呈現文字", () => {
    expect(renderToStaticMarkup(<SafeLink href="javascript:alert(1)">x</SafeLink>)).toBe("<span>x</span>");
  });
});
