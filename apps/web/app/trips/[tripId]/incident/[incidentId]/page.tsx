import type { Metadata } from "next";
import Link from "next/link";
import { ALTERNATIVE_TIER_LABELS, INCIDENT_TRIGGER_LABELS, type AlternativeTier, type ComparisonRow, type IncidentTrigger, type TransportChoice } from "@atps/core";
import { loadIncident, type IncidentAlternativeView } from "../../../../../lib/server/incident";
import { ProposalDecision } from "../../proposals/proposal-forms";
import { IncidentSteps } from "../incident-steps";
import "../../../../settings/settings.css";
import "../../proposals/proposals.css";
import "../incident.css";

// T38：即時分支（第 2.9 節）。出狀況第 2 步列出最多三個替代方案（每個一張卡：差異、交通、影響），
// 第 3 步確認並批准其中一個；批准後其餘失效、版本更新。Current State Snapshot 與完整比較表另開（?view=compare）

export const metadata: Metadata = { title: "替代方案" };
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
  ["成本", (c) => (c.newActivity.length === 0 ? "—" : cost(c.cost))],
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

const BackIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

function impactLine(c: ComparisonRow): string {
  return [c.arrival ? `${c.arrival} 到達` : "", c.affectsDinner ? "影響晚餐" : "不影響晚餐", c.affectsTomorrow ? "影響明日" : "", `體驗損失${LEVEL3[c.experienceLoss]}`].filter(Boolean).join("，");
}

export default async function IncidentPage({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string; incidentId: string }>;
  searchParams: Promise<{ pick?: string; view?: string }>;
}) {
  const { tripId, incidentId } = await params;
  const { pick, view: mode } = await searchParams;
  const view = await loadIncident(tripId, incidentId);
  if (view.state !== "ok") {
    return (
      <main className="screen incident">
        <h1>出狀況</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個 Incident，或你不是成員。"}</p>
      </main>
    );
  }
  const s = view.snapshot;
  const trigger = view.trigger ? (INCIDENT_TRIGGER_LABELS[view.trigger.type as IncidentTrigger["type"]] ?? view.trigger.type) : "現場變更";
  const applied = view.alternatives.find((a) => a.status === "applied");
  const base = `/trips/${tripId}/incident/${incidentId}`;
  const level = <span className="incident-level">{view.level ?? "不分級"}</span>;

  // 完整比較與目前狀態
  if (mode === "compare") {
    return (
      <main className="settings incident incident-compare-page">
        <Link className="back-link" href={base} aria-label="返回替代方案">
          <BackIcon />
          替代方案
        </Link>
        <h1>完整比較</h1>
        <p className="trip-line">
          {view.tripName}，{trigger}
          {level}
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
        <section aria-labelledby="compare-heading">
          <h2 id="compare-heading">替代方案比較</h2>
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
                {a.transport ? <Transport t={a.transport} /> : null}
              </li>
            ))}
          </ol>
        </section>
      </main>
    );
  }

  // 第 3 步：確認並批准一個方案
  const chosen = pick ? view.alternatives.find((a) => a.proposalId === pick) : undefined;
  if (chosen) {
    const c = chosen.comparison;
    return (
      <main className="screen incident">
        <header className="screen-head">
          <Link className="back-link" href={base} aria-label="返回替代方案">
            <BackIcon />
            替代方案
          </Link>
          <h1>確認方案</h1>
          <p className="trip-line">
            {trigger}
            {level}
          </p>
        </header>
        <IncidentSteps current={3} />
        <article aria-label={tierLabel(chosen)} className="screen-body incident-confirm">
          <h2>
            {tierLabel(chosen)}
            <span className={`proposal-status ${chosen.status}`}>{STATUS[chosen.status] ?? chosen.status}</span>
          </h2>
          <p className="summary">{chosen.summary}</p>
          <dl className="incident-facts">
            {ROWS.filter(([label]) => CONFIRM_ROWS.has(label)).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value(c)}</dd>
              </div>
            ))}
          </dl>
          {chosen.transport ? <Transport t={chosen.transport} /> : null}
          <p className="muted">批准後寫入行程並更新版本，其他方案即失效。{chosen.versionKind === "major" ? "這是 Major 變更。" : ""}</p>
        </article>
        {view.canEdit ? (
          <div className="screen-actions">
            <ProposalDecision tripId={tripId} proposalId={chosen.proposalId} pending={chosen.status === "pending"} emphasis approveLabel="批准這個方案" />
          </div>
        ) : null}
      </main>
    );
  }

  // 第 2 步：替代方案
  return (
    <main className="screen incident">
      <header className="screen-head">
        <Link className="back-link" href={`/trips/${tripId}/today${s ? `?date=${s.date}` : ""}`} aria-label="返回現在">
          <BackIcon />
          現在
        </Link>
        <h1>替代方案</h1>
        <p className="trip-line">
          {trigger}
          {level}
        </p>
      </header>
      <IncidentSteps current={2} />
      <div className="screen-body">
        {view.warnings.length > 0 ? (
          <ul className="incident-warnings" role="alert">
            {view.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        ) : null}
        {applied ? <p className="muted">已套用「{tierLabel(applied)}」，其他方案已失效。</p> : null}
        {view.alternatives.length === 0 ? <p className="muted">沒有可行的替代方案，請照原定行程或改用 Backup。</p> : null}
        <ol aria-label="替代方案" className="alt-cards">
          {view.alternatives.map((a) => (
            <li key={a.proposalId} aria-label={tierLabel(a)}>
              <Link href={`${base}?pick=${a.proposalId}`}>
                <span className="alt-head">
                  <span className="alt-tier">{tierLabel(a)}</span>
                  <span className={`proposal-status ${a.status}`}>{STATUS[a.status] ?? a.status}</span>
                </span>
                <span className="alt-summary">{a.summary}</span>
                <span className="alt-line">{a.transport ? `交通：${choice(a.transport.recommended)}` : "交通：不需移動"}</span>
                <span className="alt-line">影響：{impactLine(a.comparison)}</span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
      <div className="screen-actions">
        <Link className="ghost" href={`${base}?view=compare`}>
          完整比較與目前狀態
        </Link>
      </div>
    </main>
  );
}

const CONFIRM_ROWS = new Set(["新活動", "到達時間", "最遲離開", "成本", "影響晚餐", "對明日影響", "體驗損失", "推薦度"]);

function Transport({ t }: { t: NonNullable<IncidentAlternativeView["transport"]> }) {
  return (
    <dl className="incident-transport">
      <div><dt>推薦</dt><dd>{choice(t.recommended)}</dd></div>
      <div><dt>最快</dt><dd>{choice(t.fastest)}</dd></div>
      <div><dt>最便宜</dt><dd>{choice(t.cheapest)}</dd></div>
      <div><dt>最舒適</dt><dd>{choice(t.comfortable)}</dd></div>
      {t.estimated ? <p className="muted">沒有交通估算，以預設時間計算</p> : null}
    </dl>
  );
}
