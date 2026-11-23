import type { DataSourceAdapter } from "@atps/core";
import { createAllowlistedFetch, type FetchResult } from "@atps/security";
import { LiveDataError, isObject, str } from "./live-http";

// T22、D13：氣象廳 防災情報 警報・注意報。2026 年起氣象廳頁面讀取 bosai/warning/data/r8/{府県予報区}.json，
// 舊的 data/warning/ 已停止更新。www.jma.go.jp 在白名單 fetch 的設定檔內（T20），經 createAllowlistedFetch 讀取。

const HOST = "www.jma.go.jp";
const OFFICE_CODE = /^\d{6}$/;
const AREA_CODE = /^\d{6,7}$/;
const CLEARED = "解除";

// 2026-11-24 由氣象廳警報頁的 Warning.Common.code2WarningInfo 取得。level：20 注意報、30 警報、40 危険警報、50 特別警報
export const JMA_WARNING_CODES: Readonly<Record<string, { name: string; level: 20 | 30 | 40 | 50 }>> = Object.freeze({
  "02": { name: "暴風雪警報", level: 30 },
  "03": { name: "大雨警報", level: 30 },
  "05": { name: "暴風警報", level: 30 },
  "06": { name: "大雪警報", level: 30 },
  "07": { name: "波浪警報", level: 30 },
  "08": { name: "高潮警報", level: 30 },
  "09": { name: "土砂災害警報", level: 30 },
  "10": { name: "大雨注意報", level: 20 },
  "12": { name: "大雪注意報", level: 20 },
  "13": { name: "風雪注意報", level: 20 },
  "14": { name: "雷注意報", level: 20 },
  "15": { name: "強風注意報", level: 20 },
  "16": { name: "波浪注意報", level: 20 },
  "17": { name: "融雪注意報", level: 20 },
  "19": { name: "高潮注意報", level: 20 },
  "20": { name: "濃霧注意報", level: 20 },
  "21": { name: "乾燥注意報", level: 20 },
  "22": { name: "なだれ注意報", level: 20 },
  "23": { name: "低温注意報", level: 20 },
  "24": { name: "霜注意報", level: 20 },
  "25": { name: "着氷注意報", level: 20 },
  "26": { name: "着雪注意報", level: 20 },
  "29": { name: "土砂災害注意報", level: 20 },
  "32": { name: "暴風雪特別警報", level: 50 },
  "33": { name: "大雨特別警報", level: 50 },
  "35": { name: "暴風特別警報", level: 50 },
  "36": { name: "大雪特別警報", level: 50 },
  "37": { name: "波浪特別警報", level: 50 },
  "38": { name: "高潮特別警報", level: 50 },
  "39": { name: "土砂災害特別警報", level: 50 },
  "43": { name: "大雨危険警報", level: 40 },
  "48": { name: "高潮危険警報", level: 40 },
  "49": { name: "土砂災害危険警報", level: 40 },
});

export interface JmaWarning {
  code: string;
  // 代碼表沒有的代碼為 null，仍列出以免漏報
  name: string | null;
  level: number | null;
  status: string;
}

export interface JmaAreaWarnings {
  // 一次細分區域（6 碼）或市町村（7 碼）
  areaCode: string;
  warnings: JmaWarning[];
}

export interface JmaWarningResult {
  officeCode: string;
  reportedAt: string | null;
  areas: JmaAreaWarnings[];
  // 生效中的最高等級；沒有時為 0
  maxLevel: number;
  retrievedAt: Date;
  source: { name: string; url: string };
}

export interface JmaOptions {
  fetchUrl?: (url: string | URL) => Promise<FetchResult>;
  now?: () => Date;
}

interface Report {
  reportedAt: string;
  areas: Array<{ areaCode: string; kinds: Array<{ code: string | null; status: string }> }>;
}

function parseReports(data: unknown): Report[] {
  if (!Array.isArray(data)) throw new LiveDataError("氣象廳回應格式不正確", null);
  const reports: Report[] = [];
  for (const entry of data) {
    if (!isObject(entry) || !isObject(entry.warning)) continue;
    const reportedAt = str(entry.reportDatetime);
    if (reportedAt === null || !Number.isFinite(Date.parse(reportedAt))) continue;
    const areas: Report["areas"] = [];
    for (const key of ["class10Items", "class20Items"]) {
      const items = entry.warning[key];
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (!isObject(item) || !Array.isArray(item.kinds)) continue;
        const areaCode = str(item.areaCode);
        if (areaCode === null || !AREA_CODE.test(areaCode)) continue;
        const kinds = item.kinds.filter(isObject).map((k) => ({ code: str(k.code), status: str(k.status) ?? "" }));
        areas.push({ areaCode, kinds });
      }
    }
    reports.push({ reportedAt, areas });
  }
  if (data.length > 0 && reports.length === 0) throw new LiveDataError("氣象廳回應格式不正確", null);
  return reports.sort((a, b) => Date.parse(a.reportedAt) - Date.parse(b.reportedAt));
}

const byLevel = (a: JmaWarning, b: JmaWarning) => (b.level ?? -1) - (a.level ?? -1) || a.code.localeCompare(b.code);

// 每次發表都列出該地區當時全部的警報・注意報，所以各地區以最新一次發表的內容為準
function currentWarnings(reports: Report[]): Map<string, JmaWarning[]> {
  const latest = new Map<string, JmaWarning[]>();
  for (const report of reports) {
    for (const area of report.areas) {
      const warnings = area.kinds
        .filter((k): k is { code: string; status: string } => k.code !== null && /^\d{2}$/.test(k.code) && k.status !== CLEARED)
        .map((k) => {
          const known = JMA_WARNING_CODES[k.code];
          return { code: k.code, name: known?.name ?? null, level: known?.level ?? null, status: k.status };
        })
        .sort(byLevel);
      latest.set(area.areaCode, warnings);
    }
  }
  return latest;
}

export function createJmaWarningClient(options: JmaOptions = {}) {
  const fetchUrl = options.fetchUrl ?? createAllowlistedFetch();
  const now = options.now ?? (() => new Date());
  return {
    async warnings(officeCode: string, areaCode?: string): Promise<JmaWarningResult> {
      if (!OFFICE_CODE.test(officeCode)) throw new LiveDataError("府県予報区代碼格式不正確", null);
      if (areaCode !== undefined && !AREA_CODE.test(areaCode)) throw new LiveDataError("地區代碼格式不正確", null);
      const result = await fetchUrl(`https://${HOST}/bosai/warning/data/r8/${officeCode}.json`);
      if (!result.ok) throw new LiveDataError(`無法讀取氣象廳警報（${result.reason}）`, result.status ?? null);
      let data: unknown;
      try {
        data = JSON.parse(result.body) as unknown;
      } catch {
        throw new LiveDataError("氣象廳回應格式不正確", result.status);
      }
      const reports = parseReports(data);
      const current = currentWarnings(reports);
      const areas = [...current.entries()]
        .filter(([code]) => areaCode === undefined || code === areaCode)
        .map(([code, warnings]) => ({ areaCode: code, warnings }));
      const maxLevel = Math.max(0, ...areas.flatMap((a) => a.warnings.map((w) => w.level ?? 0)));
      return {
        officeCode,
        reportedAt: reports.at(-1)?.reportedAt ?? null,
        areas,
        maxLevel,
        retrievedAt: now(),
        source: { name: "氣象廳", url: `https://${HOST}/bosai/warning/#area_type=offices&area_code=${officeCode}` },
      };
    },
  };
}

// DataSourceAdapter（第 2.3 節）：alert 能力，只適用日本
export function createJmaWarningAdapter(options: JmaOptions = {}): DataSourceAdapter {
  const client = createJmaWarningClient(options);
  return {
    id: "jma-warning",
    capabilities: ["alert"],
    regions: ["JP"],
    fetchHosts: [HOST],
    async query(request) {
      const { officeCode, areaCode } = request.params;
      if (request.capability !== "alert" || typeof officeCode !== "string" || (areaCode !== undefined && typeof areaCode !== "string")) {
        throw new LiveDataError("不支援的查詢", null);
      }
      const result = await client.warnings(officeCode, areaCode);
      return { capability: "alert", data: result, retrievedAt: result.retrievedAt, source: result.source };
    },
  };
}
