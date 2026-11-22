import { expect, it } from "vitest";

// T02 驗證用：刻意失敗，不得 merge
it("刻意失敗", () => {
  expect(1).toBe(2);
});
