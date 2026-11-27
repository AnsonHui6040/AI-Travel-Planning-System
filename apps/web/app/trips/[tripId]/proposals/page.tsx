import type { Metadata } from "next";
import { LiveNotifications } from "../../../../components/live-notifications";
import { ScrollKeeper } from "../../../../components/scroll-keeper";
import { loadProposals } from "../../../../lib/server/proposals";
import { ProposalList, ProposalTabs, formatTime } from "./proposal-list";
import "./proposals.css";

// T34：提案分頁。待批准清單每項一行，點進去看影響範圍並批准（SH-04–SH-06）；Change Log 另一段

export const metadata: Metadata = { title: "提案" };
export const dynamic = "force-dynamic";

export default async function ProposalsPage({ params, searchParams }: { params: Promise<{ tripId: string }>; searchParams: Promise<{ view?: string }> }) {
  const { tripId } = await params;
  const tab = (await searchParams).view === "log" ? "log" : "proposals";
  const view = await loadProposals(tripId);
  if (view.state !== "ok") {
    return (
      <main className="screen proposals">
        <h1>提案</h1>
        <p>{view.state === "signed_out" ? "請先登入。" : "找不到這個行程，或你不是成員。"}</p>
      </main>
    );
  }
  return (
    <main className="screen wide proposals">
      <header className="screen-head">
        <h1>提案</h1>
        <p className="trip-line">{view.tripName}</p>
      </header>
      <LiveNotifications userId={view.userId} tripId={tripId} />
      <div className="split" data-detail="none">
        <section aria-label={tab === "log" ? "Change Log" : "提案"} className="split-list">
          <ProposalTabs tripId={tripId} view={tab} />
          {tab === "proposals" ? (
            <ProposalList tripId={tripId} proposals={view.proposals} currentId={null} />
          ) : (
            <ScrollKeeper scrollKey={`changelog:${tripId}`}>
              {view.changeLog.length === 0 ? <p className="muted">還沒有變更紀錄。</p> : null}
              <ul aria-label="Change Log" className="rows log-rows">
                {view.changeLog.map((v) => (
                  <li key={v.version} aria-label={v.version}>
                    <div className="row">
                      <span className="version">{v.version}</span>
                      <span className="log-text">
                        <span className="row-name">{v.summary}</span>
                        <span className="row-meta">
                          {v.kind === "major" ? "Major" : "Minor"}，{v.proposer} 提出，{v.approver === "自動套用" ? "自動套用" : `${v.approver} 批准`}，{formatTime(v.createdAt)}
                        </span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </ScrollKeeper>
          )}
        </section>
        <div className="split-detail">
          <p className="empty-detail">選擇一個提案查看影響範圍，並批准或否決。</p>
        </div>
      </div>
    </main>
  );
}
