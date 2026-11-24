import type { Metadata } from "next";
import { LiveNotifications } from "../../../../components/live-notifications";
import { loadProposals } from "../../../../lib/server/proposals";
import { ProposalDecision } from "./proposal-forms";
import "../../../settings/settings.css";
import "./proposals.css";

// T34：待批准提案與 Change Log（SH-04–SH-06）

export const metadata: Metadata = { title: "提案與 Change Log" };
export const dynamic = "force-dynamic";

const STATUS_LABELS = { pending: "待批准", applied: "已套用", rejected: "已否決", invalidated: "已失效" } as const;

const formatTime = (iso: string) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
};

export default async function ProposalsPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const view = await loadProposals(tripId);
  if (view.state !== "ok") {
    return (
      <main className="settings proposals">
        <h1>提案與 Change Log</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個行程，或你不是成員。"}</p>
      </main>
    );
  }
  return (
    <main className="settings proposals">
      <h1>提案與 Change Log</h1>
      <p className="trip-line">{view.tripName}</p>
      <LiveNotifications userId={view.userId} tripId={tripId} />
      <section aria-labelledby="pending-heading">
        <h2 id="pending-heading">提案</h2>
        <p className="muted">待批准 {view.proposals.filter((p) => p.status === "pending").length} 個。先批准的提案先套用；行程更新後，其他基於舊版本的提案會失效。</p>
        <ul className="proposal-list">
          {view.proposals.map((p) => (
            <li key={p.id} aria-label={p.summary}>
              <p className="summary">
                <span className={`proposal-status ${p.status}`}>{STATUS_LABELS[p.status]}</span>
                {p.summary}
              </p>
              <p className="meta">
                {p.proposer} 提出，{formatTime(p.createdAt)}
                {p.status === "pending" && p.baseVersion !== view.currentVersion ? "。行程在提出後已有更新，批准時會失效" : ""}
              </p>
              {view.canDecide ? <ProposalDecision tripId={tripId} proposalId={p.id} pending={p.status === "pending"} /> : null}
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="log-heading">
        <h2 id="log-heading">Change Log</h2>
        {view.changeLog.length === 0 ? <p className="muted">還沒有變更紀錄。</p> : null}
        <ul className="proposal-list">
          {view.changeLog.map((v) => (
            <li key={v.version} aria-label={v.version}>
              <p className="summary">
                <span className="version">{v.version}</span>
                {v.summary}
              </p>
              <p className="meta">
                {v.kind === "major" ? "Major" : "Minor"}，{v.proposer} 提出，{v.approver === "自動套用" ? "自動套用" : `${v.approver} 批准`}，{formatTime(v.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
