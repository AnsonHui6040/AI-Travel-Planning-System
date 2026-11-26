import type { Metadata } from "next";
import Link from "next/link";
import { ALTERNATIVE_TIER_LABELS, INCIDENT_TRIGGER_LABELS, type AlternativeTier, type ComparisonRow, type IncidentTrigger, type TransportChoice } from "@atps/core";
import { loadIncident, type IncidentAlternativeView } from "../../../../../lib/server/incident";
import { ProposalDecision } from "../../proposals/proposal-forms";
import "../../../../settings/settings.css";
import "../incident.css";

// T38：即時分支（第 2.9 節）。Current State Snapshot、重算範圍與三方案比較表；批准其中一個後其餘失效，版本更新

export const metadata: Metadata = { title: "Incident Mode 替代方案" };
export const dynamic = "force-dynamic";

const STATUS = { pending: "待批准", applied: "已套用", rejected: "已否決", invalidated: "已失效" } as Record<string, string>;
const LEVEL3 = { low: "低", medium: "中", high: "高" } as const;
const SCOPE = { local: "局部（至下一個 Hard Constraint）", whole_day: "全日", whole_trip: "整趟旅行" } as const;
const COMPANIONS = { ok: "狀況正常", tired: "疲累", injured: "受傷或體力受限" } as const;
const LUGGAGE = { none: "沒有行李", light: "隨身行李", heavy: "大型行李" } as const;
const MODE: Record<string, string> = { walk: "步行", rail: "鐵路", bus: "巴士", taxi: "計程車", drive: "自駕" };

const yesNo = (b: boolean) => (b ? "會" : "不會");
const minutes = (n: number | null) => (n === null ? "無資料" : `${n} 分鐘`);
function cost(c: ComparisonRow["cost"]): string {
  if (c.complete) return c.amount === 0 ? "免費" : `${c.amount.toLocaleString("zh-TW")} ${c.currency}`;
  return c.amount > 0 ? `${c.amount.toLocaleString("zh-TW")} ${c.currency} 以上` : "無資料";
}
function choice(c: TransportChoice): string {
  const price = c.price ? (c.price.amount === 0 ? "免費" : `${c.price.amount.toLocaleString("zh-TW")} ${c.price.currency}`) : "費用不明";
  return c.mode ? `${MODE[c.mode] ?? c.mode}，約 ${c.minutes} 分鐘，${price}` : `約 ${c.minutes} 分鐘`;
}

const ROWS: Array<[string, (c: ComparisonRow) => string]> = [
  ["新活動", (c) => c.newActivity.join("、") || "留空"],
  ["到達時間", (c) => c.arrival ?? "—"],
  ["最遲離開", (c) => c.leaveBy ?? "—"],
  ["成本", (c) => cost(c.cost)],
  ["步行", (c) => minutes(c.walkMinutes)],
  ["轉乘", (c) => (c.transfers === null ? "無資料" : `${c.transfers} 次`)],
  ["行李適合度", (c) => (c.luggageFit ? LEVEL3[c.luggageFit] : "無資料")],
  ["天氣風險", (c) => LEVEL3[c.weatherRisk]],
  ["影響晚餐", (c) => yesNo(c.affectsDinner)],
  ["對明日影響", (c) => yesNo(c.affectsTomorrow)],
  ["體驗損失", (c) => LEVEL3[c.experienceLoss]],
  ["推薦度", (c) => `${c.score} / 5${c.recommended ? "（推薦）" : ""}`],
];

const tierLabel = (a: IncidentAlternativeView) => ALTERNATIVE_TIER_LABELS[a.tier as AlternativeTier] ?? a.tier;

export default async function IncidentPage({ params }: { params: Promise<{ tripId: string; incidentId: string }> }) {
  const { tripId, incidentId } = await params;
  const view = await loadIncident(tripId, incidentId);
  if (view.state !== "ok") {
    return (
      <main className="settings incident">
        <h1>Incident Mode</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個 Incident，或你不是成員。"}</p>
      </main>
    );
  }
  const s = view.snapshot;
  const trigger = view.trigger ? (INCIDENT_TRIGGER_LABELS[view.trigger.type as IncidentTrigger["type"]] ?? view.trigger.type) : "現場變更";
  const applied = view.alternatives.find((a) => a.status === "applied");
  return (
    <main className="settings incident">
      <h1>Incident Mode</h1>
      <p className="trip-line">
        {view.tripName}，{trigger}
        <span className="incident-level">{view.level ?? "不分級"}</span>
      </p>
      {s ? (
        <section aria-labelledby="snapshot-heading">
          <h2 id="snapshot-heading">Current State Snapshot</h2>
          <dl className="incident-snapshot">
            <div><dt>時間</dt><dd>{s.date} {s.time}</dd></div>
            <div><dt>位置</dt><dd>{s.location ? `${s.location.lat}, ${s.location.lng}` : "未提供"}{s.currentItem ? `（${s.currentItem}）` : ""}</dd></div>
            <div><dt>同行者</dt><dd>{COMPANIONS[s.companions]}</dd></div>
            <div><dt>行李</dt><dd>{LUGGAGE[s.luggage]}</dd></div>
            <div><dt>天氣</dt><dd>{s.weather ?? "無資料"}</dd></div>
            <div><dt>即時交通</dt><dd>{s.liveTransit ?? "無即時資料"}</dd></div>
            <div><dt>已完成</dt><dd>{s.completed.join("、") || "沒有"}</dd></div>
            <div><dt>下一個固定活動</dt><dd>{s.nextFixed ? `${s.nextFixed.start} ${s.nextFixed.name}` : "沒有"}</dd></div>
            <div><dt>最遲到達</dt><dd>{s.latestArrival ?? "—"}</dd></div>
            {view.scope ? <div><dt>重算範圍</dt><dd>{SCOPE[view.scope.kind]}，{view.scope.from}–{view.scope.until}</dd></div> : null}
          </dl>
        </section>
      ) : null}
      {view.warnings.length > 0 ? (
        <ul className="incident-warnings" role="alert">
          {view.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      ) : null}
      <section aria-labelledby="compare-heading">
        <h2 id="compare-heading">替代方案比較</h2>
        <p className="muted">
          {applied ? `已套用「${tierLabel(applied)}」，其他方案已失效。` : "選擇一個方案批准後才會寫入行程並更新版本；批准其中一個，其他方案即失效。"}
        </p>
        <table className="incident-compare">
          <thead>
            <tr>
              <th scope="col">項目</th>
              {view.alternatives.map((a) => (
                <th key={a.proposalId} scope="col">
                  {tierLabel(a)}
                  <span className={`proposal-status ${a.status}`}>{STATUS[a.status] ?? a.status}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([label, value]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                {view.alternatives.map((a) => <td key={a.proposalId}>{value(a.comparison)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section aria-labelledby="options-heading">
        <h2 id="options-heading">方案內容與交通</h2>
        <ol className="incident-options">
          {view.alternatives.map((a) => (
            <li key={a.proposalId} aria-label={tierLabel(a)}>
              <p className="summary">{a.summary}</p>
              <p className="meta">版本類型：{a.versionKind === "major" ? "Major" : "Minor"}</p>
              {a.transport ? (
                <dl className="incident-transport">
                  <div><dt>推薦</dt><dd>{choice(a.transport.recommended)}</dd></div>
                  <div><dt>最快</dt><dd>{choice(a.transport.fastest)}</dd></div>
                  <div><dt>最便宜</dt><dd>{choice(a.transport.cheapest)}</dd></div>
                  <div><dt>最舒適</dt><dd>{choice(a.transport.comfortable)}</dd></div>
                  {a.transport.estimated ? <p className="muted">沒有交通估算，以預設時間計算</p> : null}
                </dl>
              ) : null}
              {view.canEdit ? <ProposalDecision tripId={tripId} proposalId={a.proposalId} pending={a.status === "pending"} /> : null}
            </li>
          ))}
        </ol>
      </section>
      <p>
        <Link href={`/trips/${tripId}/incident`}>回到 Incident Mode</Link>
      </p>
    </main>
  );
}
