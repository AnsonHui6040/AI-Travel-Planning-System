import { checkRegionPack, type RegionPack } from "@atps/core";
import { describe, expect, it } from "vitest";
import { JAPAN, JAPAN_ODPT_TRAIN_STATUS, ODPT_OPEN_LICENSES, createRegionRegistry, defaultRegions } from "./index";

// T20：日本 RegionPack（第 2.3 節、D30）
describe("日本 RegionPack", () => {
  it("通過 RegionPack 共用契約", () => {
    expect(checkRegionPack(JAPAN)).toEqual([]);
  });

  it("時區、幣別、語言", () => {
    expect(JAPAN).toMatchObject({ id: "JP", timeZone: "Asia/Tokyo", currency: "JPY", languages: ["ja"] });
  });

  it("交通狀態與天氣警報來源全部是 https，主機在官方網站白名單內", () => {
    for (const source of [...JAPAN.transitStatusSources, ...JAPAN.weatherAlertSources]) {
      const url = new URL(source.url);
      expect(url.protocol).toBe("https:");
      expect(JAPAN.officialSiteAllowlist).toContain(url.hostname);
    }
    expect(JAPAN.weatherAlertSources.map((s) => s.id)).toContain("jma-warning");
  });

  it("白名單只含有來源使用的主機，沒有多餘的主機", () => {
    const used = new Set([...JAPAN.transitStatusSources, ...JAPAN.weatherAlertSources].map((s) => new URL(s.url).hostname));
    expect([...JAPAN.officialSiteAllowlist].sort()).toEqual([...used].sort());
  });

  it("來源編號不重複", () => {
    const ids = [...JAPAN.transitStatusSources, ...JAPAN.weatherAlertSources].map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("ODPT 可用資料集（D30）", () => {
  it("只接入公共交通オープンデータ基本ライセンス或 CC BY 4.0，不接入チャレンジ限定", () => {
    expect(ODPT_OPEN_LICENSES).toEqual(["odpt_basic", "cc_by_4_0"]);
    for (const dataset of JAPAN_ODPT_TRAIN_STATUS) expect(ODPT_OPEN_LICENSES).toContain(dataset.license);
  });

  it("營運商編號格式與 API 端點", () => {
    for (const dataset of JAPAN_ODPT_TRAIN_STATUS) {
      expect(dataset.operator).toMatch(/^odpt\.Operator:[A-Za-z]+$/);
      expect(["https://api.odpt.org/api/v4/", "https://api-public.odpt.org/api/v4/"]).toContain(dataset.apiBase);
      // 公開端點不需要 key
      expect(dataset.requiresKey).toBe(dataset.apiBase === "https://api.odpt.org/api/v4/");
    }
  });

  it("收錄已確認的六個營運商", () => {
    expect(JAPAN_ODPT_TRAIN_STATUS.map((d) => d.operator).sort()).toEqual([
      "odpt.Operator:MIR",
      "odpt.Operator:TWR",
      "odpt.Operator:TamaMonorail",
      "odpt.Operator:Toei",
      "odpt.Operator:TokyoMetro",
      "odpt.Operator:YokohamaMunicipal",
    ]);
  });
});

describe("預設地區註冊表", () => {
  it("包含日本 pack", () => {
    expect(defaultRegions().require("JP").currency).toBe("JPY");
  });

  it("新增假地區 pack 不需修改 packages/core 或日本 pack", () => {
    const registry = defaultRegions();
    const fake: RegionPack = {
      id: "ZZ",
      timeZone: "Pacific/Auckland",
      currency: "NZD",
      languages: ["en"],
      transitStatusSources: [],
      weatherAlertSources: [{ id: "met", name: "假氣象局", url: "https://met.example.nz/warnings" }],
      officialSiteAllowlist: ["met.example.nz"],
    };
    registry.register(fake);
    expect(registry.list().map((p) => p.id)).toEqual(["JP", "ZZ"]);
    expect(createRegionRegistry().has("JP")).toBe(false);
  });
});
