import type { DataSourceAdapter } from "@atps/core";
import { describe, expect, it } from "vitest";
import { createDataSourceRegistry } from "./index";

// 假資料源：只在本測試註冊，不修改 packages/core
const fakeRoutes: DataSourceAdapter = {
  id: "fake-routes",
  capabilities: ["route"],
  regions: "global",
  fetchHosts: [],
  query: async (request) => ({
    capability: request.capability,
    data: { minutes: 12 },
    retrievedAt: new Date(0),
    source: { name: "假路線", url: "https://routes.example.com/" },
  }),
};

describe("DataSourceAdapter 註冊表", () => {
  it("假資料源註冊後通過共用契約並可依能力查詢", async () => {
    const registry = createDataSourceRegistry();
    registry.register(fakeRoutes);
    registry.register({ ...fakeRoutes, id: "fake-weather", capabilities: ["weather"] });
    expect(registry.withCapability("route").map((a) => a.id)).toEqual(["fake-routes"]);
    expect(registry.withCapability("alert")).toEqual([]);
    const result = await registry.require("fake-routes").query({ capability: "route", params: {} });
    expect(result.capability).toBe("route");
  });

  it("依地區篩選時包含 global 與該地區的資料源", () => {
    const registry = createDataSourceRegistry();
    registry.register(fakeRoutes);
    registry.register({ ...fakeRoutes, id: "jp-routes", regions: ["JP"] });
    registry.register({ ...fakeRoutes, id: "nz-routes", regions: ["NZ"] });
    expect(registry.withCapability("route", "JP").map((a) => a.id)).toEqual(["fake-routes", "jp-routes"]);
  });

  it("沒有宣告能力的資料源不能註冊", () => {
    const registry = createDataSourceRegistry();
    expect(() => registry.register({ ...fakeRoutes, capabilities: [] })).toThrow(/DataSourceAdapter/);
  });
});
