import type { RegionPack } from "@atps/core";
import { describe, expect, it } from "vitest";
import { createRegionRegistry } from "./index";

// 假地區 pack：只在本測試註冊，不修改 packages/core
const fakeRegion: RegionPack = {
  id: "ZZ",
  timeZone: "Pacific/Auckland",
  currency: "NZD",
  languages: ["en", "mi"],
  transitStatusSources: [{ id: "metro", name: "假地鐵", url: "https://metro.example.nz/status" }],
  weatherAlertSources: [{ id: "met", name: "假氣象局", url: "https://met.example.nz/warnings" }],
  officialSiteAllowlist: ["metro.example.nz", "met.example.nz"],
};

describe("RegionPack 註冊表", () => {
  it("假地區 pack 註冊後通過共用契約並可查詢", () => {
    const registry = createRegionRegistry();
    registry.register(fakeRegion);
    expect(registry.require("ZZ").currency).toBe("NZD");
  });

  it("不符合契約的 pack 不能註冊", () => {
    const registry = createRegionRegistry();
    expect(() => registry.register({ ...fakeRegion, timeZone: "Nowhere/City" })).toThrow(/RegionPack/);
    expect(registry.has("ZZ")).toBe(false);
  });

  it("每次建立的註冊表互相獨立", () => {
    const a = createRegionRegistry();
    a.register(fakeRegion);
    expect(createRegionRegistry().has("ZZ")).toBe(false);
  });
});
