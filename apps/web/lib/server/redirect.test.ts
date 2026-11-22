import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./redirect";

const origin = "http://localhost:3000";

describe("登入後導向只允許站內路徑", () => {
  it("站內路徑保留", () => {
    expect(safeRedirectPath("/trips/1?tab=day", origin)).toBe("/trips/1?tab=day");
  });

  it.each([
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "",
    null,
  ])("外部或無效目標 %s 改為首頁", (next) => {
    expect(safeRedirectPath(next, origin)).toBe("/");
  });
});
