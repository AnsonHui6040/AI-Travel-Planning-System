import { checkRegionPack, createRegistry, type RegionPack, type Registry } from "@atps/core";

// 第 2.3 節地區註冊表。新增地區只需建立 RegionPack 並註冊（第 7.2 節），日本 pack 於 T20 加入
export function createRegionRegistry(): Registry<RegionPack> {
  return createRegistry<RegionPack>({ kind: "RegionPack", idOf: (p) => p.id, check: checkRegionPack });
}
