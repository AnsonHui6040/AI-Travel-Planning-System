import {
  checkDataSourceAdapter,
  createRegistry,
  type DataCapability,
  type DataSourceAdapter,
  type Registry,
} from "@atps/core";

// 第 2.3 節資料源註冊表。新增資料源只需實作 DataSourceAdapter 並註冊（第 7.2 節）
export interface DataSourceRegistry extends Registry<DataSourceAdapter> {
  // 依能力與地區篩選；regions 為 global 的資料源適用所有地區
  withCapability(capability: DataCapability, region?: string): DataSourceAdapter[];
}

export function createDataSourceRegistry(): DataSourceRegistry {
  const registry = createRegistry<DataSourceAdapter>({
    kind: "DataSourceAdapter",
    idOf: (a) => a.id,
    check: checkDataSourceAdapter,
  });
  return {
    ...registry,
    withCapability: (capability, region) =>
      registry
        .list()
        .filter((a) => a.capabilities.includes(capability))
        .filter((a) => region === undefined || a.regions === "global" || a.regions.includes(region)),
  };
}
