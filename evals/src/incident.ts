import { z } from "zod";
import {
  ALTERNATIVE_TIER_LABELS,
  approvalRule,
  classifyVersionKind,
  planIncident,
  type IncidentItem,
  type IncidentPlan,
  type IncidentTrigger,
  type StoredMobilityEstimate,
} from "@atps/core";
import { enums, storedMobilityEstimate } from "@atps/schemas";
import { judgeOutput, type JudgeResult } from "./judges";
import { judgeSpec, type PlannerOutput, type Scenario, type TripItem } from "./scenario";

// T38：Incident Mode 的評估場景（第 9.3 節 E1 後段、E2、E6、E8），場景檔在 evals/incident/<編號>.json。
// 以 core 的 planIncident 計算（確定性規則，不呼叫 AI 或外部 API），結果以 T15 的判定器與下列判定器檢查。
// planIncident 只產生提案，不寫入；寫入只在批准後經 approve_proposal（pgTAP 與 E2E 另行驗證）。

const key = z.string().regex(/^[a-z0-9-]{1,40}$/);
const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
const isoDate = z.iso.date();

const trigger = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("delay"), minutes: z.int().min(0).max(600) }),
  z.strictObject({ type: z.literal("long_queue"), itemId: key }),
  z.strictObject({ type: z.literal("attraction_closed"), itemId: key }),
  z.strictObject({ type: z.literal("rail_disruption"), itemId: key }),
  z.strictObject({ type: z.literal("heavy_rain"), until: hhmm.nullable() }),
  z.strictObject({ type: z.literal("extreme_weather") }),
  z.strictObject({ type: z.literal("early_finish") }),
  z.strictObject({ type: z.literal("slot_cancelled"), itemId: key }),
  z.strictObject({ type: z.literal("flight_shift"), newFirstDate: isoDate, newLastDate: isoDate }),
]);

const BASE_JUDGES = new Set(["within_window", "dates_unchanged", "items_preserved", "only_candidates", "requires_approval", "change_kind", "proposal_count"]);

const incidentJudge = z.union([
  // 場景檔以 key 指定項目（T15 的場景用 uuid）
  z.strictObject({ type: z.literal("items_preserved"), itemIds: z.array(key).min(1) }),
  judgeSpec,
  // 每個方案的比較表含全部欄位，且只有一個推薦
  z.strictObject({ type: z.literal("comparison_complete") }),
  // 每個方案都顯示最遲離開時間
  z.strictObject({ type: z.literal("leave_by_shown") }),
  // 每個方案都提供最快、最便宜、最舒適交通
  z.strictObject({ type: z.literal("transport_options") }),
  z.strictObject({ type: z.literal("level"), level: z.enum(["L1", "L2", "L3", "L4", "none"]) }),
  z.strictObject({ type: z.literal("scope_kind"), kind: z.enum(["local", "whole_day", "whole_trip"]) }),
  // 版本類型與第 2.7 節判定一致，且為指定類型
  z.strictObject({ type: z.literal("version_kind"), kind: z.enum(["major", "minor"]) }),
]);
type IncidentJudge = z.infer<typeof incidentJudge>;

const incidentScenarioSchema = z.strictObject({
  id: z.string().regex(/^E\d{1,2}$/),
  title: z.string().min(1).max(80),
  rule: z.string().min(1).max(300),
  date: isoDate,
  timezone: z.string().min(1).max(60),
  now: hhmm,
  tripDates: z.array(isoDate).min(1).max(30),
  trigger,
  weather: z.string().max(80).nullable(),
  items: z
    .array(
      z.strictObject({
        key,
        name_zh: z.string().min(1).max(80),
        type: enums.itemType,
        zone: z.string().min(1).max(40).nullable(),
        date: isoDate.nullable(),
        start: hhmm.nullable(),
        end: hhmm.nullable(),
        hard: z.boolean().default(false),
        priority: z.int().min(1).max(5).default(3),
        weather_dependency: enums.level3,
        stay: z.int().min(5).max(600).default(60),
        verification_status: enums.verificationStatus.default("verified"),
        standby: z.boolean().default(false),
        cost: z.strictObject({ amount: z.number().min(0), currency: z.string().regex(/^[A-Z]{3}$/) }).nullable().default(null),
      }),
    )
    .min(1)
    .max(60),
  segments: z.array(z.strictObject({ from: key, to: key, estimates: z.array(storedMobilityEstimate).min(1).max(5) })).max(40).default([]),
  judges: z.array(incidentJudge).min(1).max(20),
});
export type IncidentScenario = z.infer<typeof incidentScenarioSchema>;

export const parseIncidentScenario = (value: unknown): IncidentScenario => incidentScenarioSchema.parse(value);

export interface IncidentJudgeResult {
  judge: JudgeResult["judge"] | Exclude<IncidentJudge["type"], JudgeResult["judge"]>;
  pass: boolean;
  detail: string;
}

export interface IncidentScenarioReport {
  scenario: IncidentScenario;
  plan: IncidentPlan;
  judges: IncidentJudgeResult[];
  passed: boolean;
}

const COMPARISON_FIELDS = [
  "newActivity",
  "arrival",
  "leaveBy",
  "cost",
  "walkMinutes",
  "transfers",
  "luggageFit",
  "weatherRisk",
  "affectsDinner",
  "affectsTomorrow",
  "experienceLoss",
  "score",
  "recommended",
] as const;

function toItems(scenario: IncidentScenario): IncidentItem[] {
  return scenario.items.map((i, order) => ({
    id: i.key,
    name_zh: i.name_zh,
    type: i.type,
    zone_id: i.zone,
    scheduled_date: i.date,
    scheduled_start: i.start,
    scheduled_end: i.end,
    hard: i.hard,
    priority: i.priority,
    weather_dependency: i.weather_dependency,
    suggested_stay_minutes: i.stay,
    availability: [],
    verification_status: i.verification_status,
    standby: i.standby,
    cost: i.cost,
    order,
  }));
}

// T15 判定器的行程格式：已排入為 approved，未排入且已核實為 candidate，其餘不可排入
function toTripItems(scenario: IncidentScenario): TripItem[] {
  return scenario.items.map((i) => ({
    id: i.key,
    name: i.name_zh,
    status: i.date !== null ? "approved" : i.verification_status === "verified" || i.verification_status === "partially_verified" ? "candidate" : "conflict",
    date: i.date,
    start: i.start,
    end: i.end,
    paid: i.hard,
  }));
}

function judgeExtra(spec: Exclude<IncidentJudge, z.infer<typeof judgeSpec>>, plan: IncidentPlan, items: IncidentItem[]): IncidentJudgeResult {
  const judge = spec.type;
  switch (spec.type) {
    case "comparison_complete": {
      const missing = plan.alternatives.filter((a) => COMPARISON_FIELDS.some((f) => !(f in a.comparison)));
      const recommended = plan.alternatives.filter((a) => a.comparison.recommended).length;
      const pass = plan.alternatives.length > 0 && missing.length === 0 && recommended === 1;
      return { judge, pass, detail: pass ? `${plan.alternatives.length} 個方案的比較表欄位完整，推薦 1 個` : "比較表欄位不完整或推薦數不是 1" };
    }
    case "leave_by_shown": {
      const pass = plan.alternatives.length > 0 && plan.alternatives.every((a) => a.comparison.leaveBy !== null);
      return { judge, pass, detail: pass ? `最遲離開：${plan.alternatives.map((a) => a.comparison.leaveBy).join("、")}` : "有方案沒有最遲離開時間" };
    }
    case "transport_options": {
      const withActivity = plan.alternatives.filter((a) => a.comparison.newActivity.length > 0);
      const pass = withActivity.length > 0 && withActivity.every((a) => a.transport !== null);
      return { judge, pass, detail: pass ? "有新活動的方案都提供最快、最便宜、最舒適交通" : "有新活動的方案缺少交通選項" };
    }
    case "level":
      return { judge, pass: plan.level === spec.level, detail: `分級 ${plan.level}（應為 ${spec.level}）` };
    case "scope_kind":
      return { judge, pass: plan.scope.kind === spec.kind, detail: `重算範圍 ${plan.scope.kind}（應為 ${spec.kind}）` };
    case "version_kind": {
      const offenders = plan.alternatives.filter(
        (a) => a.change.versionKind !== spec.kind || classifyVersionKind(a.change.operations, items, a.change.structural) !== a.change.versionKind,
      );
      const pass = plan.alternatives.length > 0 && offenders.length === 0;
      return { judge, pass, detail: pass ? `版本類型為 ${spec.kind}` : "版本類型不符" };
    }
  }
}

const isBaseJudge = (j: IncidentJudge): j is z.infer<typeof judgeSpec> => BASE_JUDGES.has(j.type);

export function runIncidentScenario(scenario: IncidentScenario): IncidentScenarioReport {
  const items = toItems(scenario);
  const segments = new Map<string, StoredMobilityEstimate[]>(scenario.segments.map((s) => [`${s.from}>${s.to}`, s.estimates]));
  const plan = planIncident({
    tripDates: scenario.tripDates,
    date: scenario.date,
    timezone: scenario.timezone,
    now: new Date(`${scenario.date}T${scenario.now}:00+09:00`),
    trigger: scenario.trigger as IncidentTrigger,
    items,
    fixedActivities: [],
    location: null,
    companions: "ok",
    luggage: "light",
    weather: scenario.weather,
    liveTransit: null,
    travel: (from, to) => segments.get(`${from ?? ""}>${to}`) ?? [],
    transportPreferences: [],
  });

  const output: PlannerOutput = {
    proposals: plan.alternatives.map((a) => ({
      changeKind: a.change.changeKind,
      versionKind: a.change.versionKind,
      summary: a.change.summary,
      operations: a.change.operations,
    })),
  } as PlannerOutput;
  const asScenario = {
    id: scenario.id,
    title: scenario.title,
    rule: scenario.rule,
    role: "live_planner",
    runs: 1,
    instruction: "",
    trip: { items: toTripItems(scenario) },
    judges: scenario.judges.filter(isBaseJudge),
  } as Scenario;
  const judges: IncidentJudgeResult[] = [
    ...judgeOutput(asScenario, output),
    ...scenario.judges.filter((j) => !isBaseJudge(j)).map((j) => judgeExtra(j as Exclude<IncidentJudge, z.infer<typeof judgeSpec>>, plan, items)),
  ];
  // 第 2.6 節：Incident Mode 的提案一律需批准
  const approval = plan.alternatives.every((a) => approvalRule(a.change.changeKind).apply === "approval");
  return { scenario, plan, judges, passed: approval && judges.every((j) => j.pass) };
}

const cell = (s: string): string => s.replaceAll("|", "\\|").replaceAll("\n", " ");
const LEVEL_LABEL = { low: "低", medium: "中", high: "高" } as const;
const yesNo = (b: boolean) => (b ? "是" : "否");

export function renderIncidentReport(report: IncidentScenarioReport, meta: { date: string }): string {
  const { scenario, plan } = report;
  const s = plan.snapshot;
  return [
    `# 評估報告：${scenario.id} ${scenario.title}`,
    "",
    "| 項目 | 內容 |",
    "|---|---|",
    `| 規則 | ${cell(scenario.rule)} |`,
    `| 日期 | ${meta.date} |`,
    "| 模式 | 確定性規則（core 的 planIncident，不呼叫 AI 或外部 API） |",
    `| 結果 | ${report.passed ? "PASS" : "FAIL"} |`,
    `| 分級 | ${plan.level === "none" ? "不分級" : plan.level} |`,
    `| 重算範圍 | ${plan.scope.kind}，${plan.scope.date} ${plan.scope.from}–${plan.scope.until} |`,
    `| 現在 | ${s.time}，${s.currentItem ?? "沒有進行中的項目"} |`,
    `| 下一個 Hard Constraint | ${s.nextFixed ? `${s.nextFixed.start} ${s.nextFixed.name}，最遲到達 ${s.latestArrival}` : "沒有"} |`,
    ...(plan.warnings.length > 0 ? [`| 提醒 | ${cell(plan.warnings.join("；"))} |`] : []),
    "",
    "## 方案",
    "",
    "| 方案 | 新活動 | 到達 | 最遲離開 | 成本 | 步行 | 轉乘 | 行李 | 天氣風險 | 影響晚餐 | 影響明日 | 體驗損失 | 推薦度 |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...plan.alternatives.map((a) => {
      const c = a.comparison;
      return `| ${ALTERNATIVE_TIER_LABELS[a.tier]}${c.recommended ? "（推薦）" : ""} | ${cell(c.newActivity.join("、") || "留空")} | ${c.arrival ?? "—"} | ${c.leaveBy ?? "—"} | ${c.cost.complete ? `${c.cost.amount} ${c.cost.currency}` : c.cost.amount > 0 ? `${c.cost.amount} ${c.cost.currency} 以上` : "無資料"} | ${c.walkMinutes ?? "無資料"} | ${c.transfers ?? "無資料"} | ${c.luggageFit ? LEVEL_LABEL[c.luggageFit] : "無資料"} | ${LEVEL_LABEL[c.weatherRisk]} | ${yesNo(c.affectsDinner)} | ${yesNo(c.affectsTomorrow)} | ${LEVEL_LABEL[c.experienceLoss]} | ${c.score} |`;
    }),
    "",
    "## 判定",
    "",
    "| 判定 | 結果 | 說明 |",
    "|---|---|---|",
    ...report.judges.map((j) => `| ${j.judge} | ${j.pass ? "PASS" : "FAIL"} | ${cell(j.detail)} |`),
    "",
  ].join("\n");
}
