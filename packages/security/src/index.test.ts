import { describe, expect, it } from "vitest";
import { redactSecrets } from "./index";

// S-10、C-04：log 與錯誤訊息遮罩 API key
describe("redactSecrets", () => {
  it("把已知的 key 換成遮罩", () => {
    expect(redactSecrets("call failed: sk-test-ABCD1234 rejected", ["sk-test-ABCD1234"])).toBe(
      "call failed: [已遮罩] rejected",
    );
  });

  it("同一個 key 出現多次全部遮罩", () => {
    expect(redactSecrets("a sk-x-12345678 b sk-x-12345678", ["sk-x-12345678"])).toBe("a [已遮罩] b [已遮罩]");
  });

  it("遮罩常見 key 格式與 Bearer token，即使未列出", () => {
    const text = "key=sk-ant-api03-abcdefghijklmnop AIzaSyA1234567890abcdefghijklmnopqrstu Bearer abc.def.ghi";
    const result = redactSecrets(text, []);
    expect(result).not.toContain("sk-ant-api03-abcdefghijklmnop");
    expect(result).not.toContain("AIzaSyA1234567890abcdefghijklmnopqrstu");
    expect(result).not.toContain("abc.def.ghi");
  });

  it("忽略過短的值，避免誤遮一般文字", () => {
    expect(redactSecrets("abc", ["a"])).toBe("abc");
  });

  it("key 含正規表示式符號時仍正確遮罩", () => {
    expect(redactSecrets("x key+with.dots*1234 y", ["key+with.dots*1234"])).toBe("x [已遮罩] y");
  });
});
