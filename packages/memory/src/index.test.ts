import { describe, expect, it } from "vitest";
import { emptyMemoryReader } from "./index";

describe("MemoryReader 預設實作", () => {
  it("回傳空記憶（T41 實作完整版本）", async () => {
    await expect(
      emptyMemoryReader.read({
        ownerIds: ["44444444-4444-4444-8444-444444444444"],
        tripId: null,
        scope: { layers: ["personal", "planning_rules", "trip_context"], kinds: ["constraint", "preference"] },
      }),
    ).resolves.toEqual([]);
  });
});
