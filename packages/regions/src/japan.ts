import type { OfficialSource, RegionPack } from "@atps/core";

// T20：日本 RegionPack（第 2.3 節、D30）。
// 來源於 2026-11-24 以瀏覽器逐一開啟確認為營運商或氣象廳的官方頁面。
// 主機須同時加入 packages/security/src/fetch-allowlist.json（經 PR 修改）。
// 沒有可確認官方頁面的營運商不列入；Verification 對這些路線顯示「無即時資料」。

const TRANSIT: OfficialSource[] = [
  { id: "jr-east", name: "JR 東日本 運行情報", url: "https://traininfo.jreast.co.jp/train_info/kanto.aspx" },
  { id: "jr-central", name: "JR 東海 在來線運行情報", url: "https://traininfo.jr-central.co.jp/zairaisen/" },
  { id: "jr-west", name: "JR 西日本 列車運行情報", url: "https://trafficinfo.westjr.co.jp/" },
  { id: "jr-hokkaido", name: "JR 北海道 列車運行情報", url: "https://www3.jrhokkaido.co.jp/webunkou/" },
  { id: "jr-kyushu", name: "JR 九州 運行情報", url: "https://www.jrkyushu.co.jp/trains/info/" },
  { id: "tokyo-metro", name: "東京 Metro 運行情報", url: "https://www.tokyometro.jp/unkou/" },
  { id: "osaka-metro", name: "Osaka Metro 運行情報", url: "https://subway.osakametro.co.jp/guide/subway_information.php" },
  { id: "keikyu", name: "京急電鐵 鐵道運行情報", url: "https://unkou.keikyu.co.jp/" },
  { id: "keisei", name: "京成電鐵 運行情報", url: "https://www.keisei.co.jp/traininfo/index.php" },
  { id: "nankai", name: "南海電鐵 運行狀況", url: "https://www.traffic.nankai.co.jp/railinfo/01.html" },
  { id: "hankyu", name: "阪急電鐵 運行狀況", url: "https://www.hankyu.co.jp/railinfo/index.html" },
];

const WEATHER: OfficialSource[] = [{ id: "jma-warning", name: "氣象廳 警報・注意報", url: "https://www.jma.go.jp/bosai/warning/" }];

const hosts = (sources: readonly OfficialSource[]) => [...new Set(sources.map((s) => new URL(s.url).hostname))];

export const JAPAN: RegionPack = Object.freeze({
  id: "JP",
  timeZone: "Asia/Tokyo",
  currency: "JPY",
  languages: Object.freeze(["ja"]),
  transitStatusSources: Object.freeze(TRANSIT),
  weatherAlertSources: Object.freeze(WEATHER),
  officialSiteAllowlist: Object.freeze(hosts([...TRANSIT, ...WEATHER])),
});

// D30：ODPT 只接入「公共交通オープンデータ基本ライセンス」或 CC BY 4.0 的資料集；
// 「チャレンジ限定ライセンス」的資料集（例如京急、西武、京王、東武、東急、JR 東日本アイステイションズ）不接入。
export const ODPT_OPEN_LICENSES = ["odpt_basic", "cc_by_4_0"] as const;
export type OdptLicense = (typeof ODPT_OPEN_LICENSES)[number];

export interface OdptTrainStatusDataset {
  operator: string;
  name: string;
  license: OdptLicense;
  // 授權標示（CC BY 4.0 須標示出處）
  attribution: string;
  apiBase: "https://api.odpt.org/api/v4/" | "https://api-public.odpt.org/api/v4/";
  requiresKey: boolean;
  // ckan.odpt.org 的資料集頁面
  catalog: string;
}

const KEYED = "https://api.odpt.org/api/v4/" as const;

// 2026-11-24 由 ckan.odpt.org 各資料集頁面確認授權與 API 端點
export const JAPAN_ODPT_TRAIN_STATUS: readonly OdptTrainStatusDataset[] = Object.freeze([
  {
    operator: "odpt.Operator:TokyoMetro",
    name: "東京 Metro",
    license: "odpt_basic",
    attribution: "東京メトロ（公共交通オープンデータセンター）",
    apiBase: KEYED,
    requiresKey: true,
    catalog: "https://ckan.odpt.org/dataset/r_train_status-tokyometro",
  },
  {
    operator: "odpt.Operator:Toei",
    name: "東京都交通局（都營地下鐵、東京櫻花路面電車、日暮里・舍人線）",
    license: "cc_by_4_0",
    attribution: "東京都交通局・公共交通オープンデータ協議会（CC BY 4.0）",
    apiBase: "https://api-public.odpt.org/api/v4/",
    requiresKey: false,
    catalog: "https://ckan.odpt.org/dataset/r_train_status-toei",
  },
  {
    operator: "odpt.Operator:TWR",
    name: "東京臨海高速鐵道（臨海線）",
    license: "odpt_basic",
    attribution: "東京臨海高速鉄道（公共交通オープンデータセンター）",
    apiBase: KEYED,
    requiresKey: true,
    catalog: "https://ckan.odpt.org/dataset/r_train_status-twr",
  },
  {
    operator: "odpt.Operator:MIR",
    name: "首都圏新都市鐵道（筑波快線）",
    license: "odpt_basic",
    attribution: "首都圏新都市鉄道（公共交通オープンデータセンター）",
    apiBase: KEYED,
    requiresKey: true,
    catalog: "https://ckan.odpt.org/dataset/r_train_status-mir",
  },
  {
    operator: "odpt.Operator:TamaMonorail",
    name: "多摩都市單軌電車",
    license: "odpt_basic",
    attribution: "多摩都市モノレール（公共交通オープンデータセンター）",
    apiBase: KEYED,
    requiresKey: true,
    catalog: "https://ckan.odpt.org/dataset/r_train_status-tamamonorail",
  },
  {
    operator: "odpt.Operator:YokohamaMunicipal",
    name: "橫濱市營地下鐵",
    license: "odpt_basic",
    attribution: "横浜市交通局（公共交通オープンデータセンター）",
    apiBase: KEYED,
    requiresKey: true,
    catalog: "https://ckan.odpt.org/dataset/r_train_status-yokohamamunicipal",
  },
]);
