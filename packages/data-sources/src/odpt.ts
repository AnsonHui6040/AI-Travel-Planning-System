import type { DataSourceAdapter, KeyTester, RegionPack, RouteStatus, TransitCondition } from "@atps/core";
import { JAPAN_ODPT_TRAIN_STATUS, ODPT_OPEN_LICENSES, type OdptTrainStatusDataset } from "@atps/regions";
import { officialTransitReport } from "@atps/schemas";
import { LiveDataError, createJsonGetter, isObject, str, type LiveFetchOptions } from "./live-http";

// T22、D30：ODPT 列車運行資訊（odpt:TrainInformation）。只接入日本 pack 列出、
// 且授權為「公共交通オープンデータ基本ライセンス」或 CC BY 4.0 的資料集。
// 基本ライセンス的資料以使用者本人的 key 呼叫（C-05），key 依 ODPT 規格放在查詢參數，不出現在回傳值或錯誤訊息。

const OFFICIAL_VALID_MS = 15 * 60 * 1000;
const OFFICIAL_MAX_AGE_MS = 30 * 60 * 1000;
const KEY_TEST_OPERATOR = "odpt.Operator:TokyoMetro";

const text = (v: unknown): string | null => (isObject(v) ? str(v.ja) ?? str(v.en) : null);

// 平常時 odpt:trainInformationStatus 省略
export function classifyOdptStatus(status: string | null): TransitCondition {
  if (status === null || status.trim() === "") return "normal";
  if (/平常|通常運転/.test(status)) return "normal";
  if (/見合わせ|運休|不通/.test(status)) return "suspended";
  if (/遅延|遅れ|乱れ|運転再開/.test(status)) return "delayed";
  return "other_abnormal";
}

function assertOpenDataset(dataset: OdptTrainStatusDataset) {
  if (!(ODPT_OPEN_LICENSES as readonly string[]).includes(dataset.license)) throw new LiveDataError("只接入基本ライセンス或 CC 授權的資料集", null);
  const listed = JAPAN_ODPT_TRAIN_STATUS.some((d) => d.operator === dataset.operator && d.apiBase === dataset.apiBase && d.license === dataset.license);
  if (!listed) throw new LiveDataError("不是日本 pack 列出的 ODPT 資料集", null);
}

function parseRecords(data: unknown, dataset: OdptTrainStatusDataset): RouteStatus[] {
  if (!Array.isArray(data)) throw new LiveDataError("ODPT 回應格式不正確", null);
  const statuses: RouteStatus[] = [];
  for (const record of data) {
    if (!isObject(record) || record["odpt:operator"] !== dataset.operator) continue;
    const observedAt = str(record["dc:date"]);
    if (observedAt === null || !Number.isFinite(Date.parse(observedAt))) continue;
    const routeId = str(record["odpt:railway"]) ?? dataset.operator;
    const validUntil = str(record["dct:valid"]);
    const resume = str(record["odpt:resumeEstimate"]);
    statuses.push({
      routeId,
      condition: classifyOdptStatus(text(record["odpt:trainInformationStatus"])),
      text: text(record["odpt:trainInformationText"]),
      cause: text(record["odpt:trainInformationCause"]),
      resumeEstimate: resume !== null && Number.isFinite(Date.parse(resume)) ? resume : null,
      observedAt,
      validUntil: validUntil !== null && Number.isFinite(Date.parse(validUntil)) ? validUntil : null,
      source: { name: dataset.attribution, url: dataset.catalog },
    });
  }
  return statuses;
}

export function createOdptClient(options: LiveFetchOptions = {}) {
  const get = createJsonGetter("ODPT", options);
  return {
    async trainStatus(dataset: OdptTrainStatusDataset, apiKey: string | null): Promise<RouteStatus[]> {
      assertOpenDataset(dataset);
      if (dataset.requiresKey && !apiKey) throw new LiveDataError("此資料集需要使用者的 ODPT key", null);
      // 「odpt:」會被當成 scheme，所以以字串相接而不用相對網址
      const url = new URL(`${dataset.apiBase}odpt:TrainInformation`);
      url.searchParams.set("odpt:operator", dataset.operator);
      if (dataset.requiresKey && apiKey) url.searchParams.set("acl:consumerKey", apiKey);
      return parseRecords(await get(url), dataset);
    },
  };
}

export function createOdptKeyTester(options: LiveFetchOptions = {}): KeyTester {
  const client = createOdptClient(options);
  const dataset = JAPAN_ODPT_TRAIN_STATUS.find((d) => d.operator === KEY_TEST_OPERATOR);
  return {
    provider: "odpt",
    async test(secret) {
      if (!dataset) return { ok: false, reason: "找不到測試用的 ODPT 資料集" };
      try {
        await client.trainStatus(dataset, secret);
        return { ok: true };
      } catch (error) {
        const status = error instanceof LiveDataError ? error.status : null;
        if (status === 400 || status === 401 || status === 403) return { ok: false, reason: "ODPT key 無效，或尚未取得東京 Metro 資料的使用權限" };
        if (status === 429) return { ok: false, reason: "ODPT 請求過於頻繁，請稍後再試" };
        return { ok: false, reason: "無法連線 ODPT，請稍後再試" };
      }
    },
  };
}

// DataSourceAdapter（第 2.3 節）：transit_status 能力。每次請求以使用者本人的 key 建立（C-05）
export function createOdptAdapter(options: LiveFetchOptions & { apiKey: string | null }): DataSourceAdapter {
  const client = createOdptClient(options);
  const now = options.now ?? (() => new Date());
  return {
    id: "odpt-train-information",
    capabilities: ["transit_status"],
    regions: ["JP"],
    // 固定的官方 API 端點，不經白名單 fetch
    fetchHosts: [],
    async query(request) {
      const operator = request.params.operator;
      const dataset = JAPAN_ODPT_TRAIN_STATUS.find((d) => d.operator === operator);
      if (request.capability !== "transit_status" || !dataset) throw new LiveDataError("不支援的查詢", null);
      const statuses = await client.trainStatus(dataset, options.apiKey);
      return { capability: "transit_status", data: statuses, retrievedAt: now(), source: { name: dataset.attribution, url: dataset.catalog } };
    },
  };
}

// 其他營運商：Verification 以白名單 fetch 讀取官方運行情報頁後回報，經 schema 與來源檢查才採用（S-01、S-05）
export function acceptOfficialTransitReport(
  raw: unknown,
  pack: Pick<RegionPack, "officialSiteAllowlist">,
  now: Date,
): { ok: true; status: RouteStatus } | { ok: false; reason: string } {
  const parsed = officialTransitReport.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "核實結果格式不正確" };
  const report = parsed.data;
  const host = new URL(report.sourceUrl).hostname.toLowerCase();
  if (!pack.officialSiteAllowlist.includes(host)) return { ok: false, reason: "來源不在官方網站白名單" };
  const checked = Date.parse(report.checkedAt);
  const age = now.getTime() - checked;
  if (age < 0) return { ok: false, reason: "核實時間晚於目前時間" };
  if (age > OFFICIAL_MAX_AGE_MS) return { ok: false, reason: "核實時間超過 30 分鐘" };
  return {
    ok: true,
    status: {
      routeId: report.routeId,
      condition: report.condition,
      text: report.text,
      cause: null,
      resumeEstimate: null,
      observedAt: report.checkedAt,
      validUntil: new Date(checked + OFFICIAL_VALID_MS).toISOString(),
      source: { name: host, url: report.sourceUrl },
    },
  };
}
