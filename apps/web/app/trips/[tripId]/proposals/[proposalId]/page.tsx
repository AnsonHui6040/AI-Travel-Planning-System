import type { Metadata } from "next";
import Link from "next/link";
import { LiveNotifications } from "../../../../../components/live-notifications";
import { loadProposals } from "../../../../../lib/server/proposals";
import { ProposalDecision } from "../proposal-forms";
import { ProposalList, ProposalTabs, STATUS_LABELS, formatTime } from "../proposal-list";
import "../proposals.css";

// T34：提案詳情。影響範圍（日期與每個變更）與批准、否決；批准者由伺服器取自 session

export const metadata: Metadata = { title: "提案" };
export const dynamic = "force-dynamic";

export default async function ProposalPage({ params }: { params: Promise<{ tripId: string; proposalId: string }> }) {
  const { tripId, proposalId } = await params;
  const view = await loadProposals(tripId);
  const p = view.state === "ok" ? view.proposals.find((x) => x.id === proposalId) : undefined;
  if (view.state !== "ok" || !p) {
    return (
      <main className="screen proposals">
        <h1>提案</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個提案，或你不是成員。"}</p>
      </main>
    );
  }
  const stale = p.status === "pending" && p.baseVersion !== view.currentVersion;
  return (
    <main className="screen wide proposals">
      <LiveNotifications userId={view.userId} tripId={tripId} />
      <div className="split" data-detail="open">
        <section aria-label="提案" className="split-list">
          <p className="list-title">提案</p>
          <ProposalTabs tripId={tripId} view="proposals" />
          <ProposalList tripId={tripId} proposals={view.proposals} currentId={p.id} />
        </section>
        <article aria-label={p.summary} className="split-detail proposal-detail">
          <Link className="back-link" href={`/trips/${tripId}/proposals`} aria-label="返回提案清單">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            提案
          </Link>
          <div className="scroll-area">
            <h1>{p.summary}</h1>
            <p className="tags">
              <span className={`proposal-status ${p.status}`}>{STATUS_LABELS[p.status]}</span>
              {p.versionKind ? <span className="tag">{p.versionKind === "major" ? "Major" : "Minor"}</span> : null}
            </p>
            <p className="meta">
              {p.proposer} 提出，{formatTime(p.createdAt)}
            </p>
            {stale ? <p className="error">行程在提出後已有更新，批准時會失效。</p> : null}
            <section aria-label="影響範圍" className="impact">
              <h2>影響範圍</h2>
              {p.dates.length > 0 ? <p>日期：{p.dates.map((d) => d.slice(5).replace("-", "/")).join("、")}</p> : null}
              <ul>
                {p.operations.map((op) => (
                  <li key={op}>{op}</li>
                ))}
              </ul>
              {p.reason ? <p className="muted">原因：{p.reason}</p> : null}
            </section>
          </div>
          {view.canDecide && p.status !== "pending" ? <p className="muted">這個提案{STATUS_LABELS[p.status]}。</p> : null}
          {!view.canDecide ? <p className="muted">{p.status === "pending" ? "只有 Owner 與 Companion 可以批准或否決。" : `這個提案${STATUS_LABELS[p.status]}。`}</p> : null}
          {view.canDecide ? (
            // 處理後仍保留同一個元件（按鈕隱藏），才能顯示結果訊息
            <div className="screen-actions">
              <ProposalDecision key={p.id} tripId={tripId} proposalId={p.id} pending={p.status === "pending"} emphasis />
            </div>
          ) : null}
        </article>
      </div>
    </main>
  );
}
