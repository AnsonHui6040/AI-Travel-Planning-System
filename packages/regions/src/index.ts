import { checkRegionPack, createRegistry, type RegionPack, type Registry } from "@atps/core";
import { JAPAN } from "./japan";

// 第 2.3 節地區註冊表。新增地區只需建立 RegionPack 並註冊（第 7.2 節）
export function createRegionRegistry(): Registry<RegionPack> {
  return createRegistry<RegionPack>({ kind: "RegionPack", idOf: (p) => p.id, check: checkRegionPack });
}

// 預設地區：日本（T20）
export function defaultRegions(): Registry<RegionPack> {
  const registry = createRegionRegistry();
  registry.register(JAPAN);
  return registry;
}

export {
  JAPAN,
  JAPAN_ODPT_TRAIN_STATUS,
  ODPT_OPEN_LICENSES,
  type OdptLicense,
  type OdptTrainStatusDataset,
} from "./japan";
